import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const schema = name => read(`packages/contracts/schema/${name}.schema.json`)

function check(value, rule, path) {
  if (rule.oneOf) {
    const matches = rule.oneOf.filter(option => {
      try { check(value, option, path); return true } catch { return false }
    })
    assert.equal(matches.length, 1, `${path}: expected exactly one matching shape`)
    return
  }
  if (rule.$ref) return check(value, schema(rule.$ref.replace(/\.schema\.json$/, '')), path)
  if (rule.enum) {
    assert.ok(rule.enum.includes(value), `${path}: enum value expected`)
    return
  }
  const types = Array.isArray(rule.type) ? rule.type : [rule.type]
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array'
    : Number.isInteger(value) ? 'integer' : typeof value === 'number' ? 'number' : typeof value
  assert.ok(types.includes(actual) || (actual === 'integer' && types.includes('number')), `${path}: expected ${types.join('|')}, got ${actual}`)
  if (actual === 'object') {
    for (const key of rule.required || []) assert.ok(Object.hasOwn(value, key), `${path}.${key}: required`)
    for (const [key, child] of Object.entries(value)) {
      const property = rule.properties?.[key]
      if (property) check(child, property, `${path}.${key}`)
      else if (typeof rule.additionalProperties === 'object') check(child, rule.additionalProperties, `${path}.${key}`)
      else assert.equal(rule.additionalProperties, true, `${path}.${key}: unknown field`)
    }
  }
  if (actual === 'array') {
    if (rule.minItems !== undefined) assert.ok(value.length >= rule.minItems, `${path}: too few items`)
    if (rule.maxItems !== undefined) assert.ok(value.length <= rule.maxItems, `${path}: too many items`)
    for (const [index, item] of value.entries()) check(item, rule.items, `${path}[${index}]`)
  }
  if (rule.minimum !== undefined) assert.ok(value >= rule.minimum, `${path}: below minimum`)
  if (rule.maximum !== undefined) assert.ok(value <= rule.maximum, `${path}: above maximum`)
  if (rule.minLength !== undefined) assert.ok(value.length >= rule.minLength, `${path}: too short`)
}

const clarifyQuestion = { qid: 'q1', question: 'Which option?', choices: null }
const samples = {
  'backend-info': [{ port: 1421, pid: 421, replay_epoch: 'example-epoch' }],
  'bundled-tools-inventory': [{
    has_manifest: true,
    tools: [{ name: 'python', version: '3.14', path: 'example-data/runtime/tools/python', present: true }],
  }],
  'dev-defaults': [{ python_path: 'example-build/venv/python', storage_path: 'example-build/desktop-data' }],
  'desktop-failure': [{ kind: 'desktop_failure', code: 'operation_failed', category: 'operation' }],
  'gateway-event': [
    { kind: 'message.delta', session_id: 'session-example', seq: 2, payload: { text: 'hello' } },
    { kind: 'status.update', payload: {} },
  ],
  'gateway-request': [
    {
      id: 'srq-1', method: 'approval', params: {
        session_id: 'session-example', request_id: 'request-example', description: 'Run a tool',
        command: 'tool command', choices: ['once', 'deny'], tool_name: null,
      },
    },
    {
      id: 'srq-2', method: 'clarify', params: {
        session_id: 'session-example', questions: [clarifyQuestion], answers: { q1: null },
      },
    },
    {
      id: 'srq-3', method: 'clarify', params: {
        session_id: 'session-example',
        questions: [{ qid: 'permissions', question: 'Which permissions?', choices: ['read', 'write'], multi_select: true }],
        answers: { permissions: '["read"]' },
      },
    },
  ],
  'packed-defaults': [{ storage_path: 'example-data', initialized: true }],
  'replay-result': [{
    events: [{ type: 'message.delta', session_id: 'session-example', seq: 2, payload: { text: 'hello' } }],
    latest_seq: 2, count: 1, epoch: 'example-epoch', truncated: false,
    open_requests: [{ id: 'srq-2', method: 'clarify', params: { session_id: 'session-example', questions: [clarifyQuestion] } }],
  }],
  'runtime-probe': [
    { tool: 'Python', kind: 'runtime', path: 'example-tools/python', version: 'Python 3.14 CPython AMD64', usable: true, reason: '' },
    { tool: 'Git', kind: 'command', path: null, version: null, usable: false, reason: 'Executable not found' },
  ],
  'saved-model-config': [{ provider: 'custom', model: 'example-model', base_url: 'https://example.com/api' }],
}
for (const [name, values] of Object.entries(samples)) {
  for (const [index, value] of values.entries()) check(value, schema(name), `${name}[${index}]`)
}
const gatewayRequest = schema('gateway-request')
assert.throws(() => check({ id: 'srq-1', method: 'approval', params: { session_id: 's1' } }, gatewayRequest, 'approval-without-request-id'))
assert.throws(() => check({ id: 'srq-2', method: 'clarify', params: { session_id: 's1' } }, gatewayRequest, 'clarify-without-questions'))
assert.throws(() => check({ id: 'srq-2', method: 'clarify', params: { session_id: 's1', questions: [], answers: { q1: 1 } } }, gatewayRequest, 'clarify-with-invalid-answer'))
console.log('Shared contract schemas verified')
