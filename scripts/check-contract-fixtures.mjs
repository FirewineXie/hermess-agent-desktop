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

for (const [name, fixtures] of Object.entries({
  'backend-info': ['backend-info'],
  'bundled-tools-inventory': ['bundled-tools-inventory'],
  'dev-defaults': ['dev-defaults'],
  'desktop-failure': ['desktop-failure'],
  'gateway-event': ['gateway-event', 'gateway-event-no-session'],
  'gateway-request': ['gateway-request-approval', 'gateway-request-clarify', 'gateway-request-clarify-multi'],
  'packed-defaults': ['packed-defaults'],
  'replay-result': ['replay-result'],
  'runtime-probe': ['runtime-probe-found', 'runtime-probe-missing'],
  'saved-model-config': ['saved-model-config'],
})) {
  for (const fixture of fixtures) check(read(`packages/contracts/fixtures/${fixture}.json`), schema(name), fixture)
}
const gatewayRequest = schema('gateway-request')
assert.throws(() => check({ id: 'srq-1', method: 'approval', params: { session_id: 's1' } }, gatewayRequest, 'approval-without-request-id'))
assert.throws(() => check({ id: 'srq-2', method: 'clarify', params: { session_id: 's1' } }, gatewayRequest, 'clarify-without-questions'))
assert.throws(() => check({ id: 'srq-2', method: 'clarify', params: { session_id: 's1', questions: [], answers: { q1: 1 } } }, gatewayRequest, 'clarify-with-invalid-answer'))
console.log('Shared contract fixtures verified')
