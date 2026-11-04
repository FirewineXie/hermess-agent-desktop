import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/features/session-management/sessionImport.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
vm.runInNewContext(compiled, { exports })
const { parseSessionImport } = exports

test('accepts Dashboard JSON, JSONL and session arrays', () => {
  assert.equal(parseSessionImport('{"id":"one"}')[0].id, 'one')
  assert.equal(parseSessionImport('{"sessions":[{"id":"one"}]}')[0].id, 'one')
  assert.equal(parseSessionImport('[{"id":"one"}]')[0].id, 'one')
  assert.deepEqual(Array.from(parseSessionImport('{"id":"one"}\n{"id":"two"}'), row => row.id), ['one', 'two'])
})

test('rejects empty, malformed and duplicate session entries', () => {
  for (const input of ['', '{}', '[]', '[{"id":"one"},{"id":"one"}]', '{"id":"one"}\n{bad}']) {
    assert.throws(() => parseSessionImport(input))
  }
})
