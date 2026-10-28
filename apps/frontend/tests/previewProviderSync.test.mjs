import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncPreviewProvider } from '../src/preview/providerSync.ts'

const source = { id: 'provider-a', name: 'Provider A', base_url: 'https://a.example/v1', model: 'model-a', models: ['model-a'], source: 'preview', is_current: true }

test('preview sync changes only the selected target after applying', () => {
  const target = []
  assert.equal(syncPreviewProvider(source, target, 'coding', false, false).status, 'ready')
  assert.deepEqual(target, [])
  const applied = syncPreviewProvider(source, target, 'coding', true, false)
  assert.equal(applied.status, 'copied')
  assert.equal(target[0].is_current, false)
  assert.equal(target[0].model, 'model-a')
  assert.equal(source.is_current, true)
})

test('preview sync reports conflicts and never replaces an address-only match', () => {
  const target = [{ ...source, id: 'other-id', name: 'Another provider', model: 'old-model', is_current: true }]
  const result = syncPreviewProvider(source, target, 'coding', true, true)
  assert.equal(result.status, 'conflict')
  assert.equal(result.conflictKind, 'address')
  assert.equal(target[0].model, 'old-model')
})

test('preview replacement preserves the target main-model flag', () => {
  const target = [{ ...source, model: 'old-model', models: ['old-model'], is_current: true }]
  assert.equal(syncPreviewProvider(source, target, 'coding', false, false).status, 'conflict')
  assert.equal(syncPreviewProvider(source, target, 'coding', true, true).status, 'copied')
  assert.equal(target[0].model, 'model-a')
  assert.equal(target[0].is_current, true)
})
