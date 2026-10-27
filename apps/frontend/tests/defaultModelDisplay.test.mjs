import assert from 'node:assert/strict'
import { test } from 'node:test'
import { savedModelFromOptions } from '../src/features/models/model.ts'

test('shows the saved default model without a model catalog', () => {
  assert.equal(savedModelFromOptions({ providers: [] }, {
    provider: 'custom', model: 'configured-model', base_url: 'https://example.com/v1',
  })?.model, 'configured-model')
})

test('shows a default model when its provider is omitted', () => {
  assert.equal(savedModelFromOptions({ providers: [] }, {
    provider: '', model: 'configured-model', base_url: '',
  })?.model, 'configured-model')
})

test('uses the backend model options when saved config is unavailable', () => {
  assert.deepEqual(savedModelFromOptions({ providers: [], provider: 'custom', model: 'runtime-model' }, {
    provider: '', model: '', base_url: '',
  }), { provider: 'custom', model: 'runtime-model', name: 'custom', baseUrl: '' })
})

test('uses the first available model when no default is configured', () => {
  assert.deepEqual(savedModelFromOptions({ providers: [
    { slug: 'missing', name: 'Missing', models: ['unavailable'], authenticated: false },
    { slug: 'empty', name: 'Empty', models: [] },
    { slug: 'ready', name: 'Ready', models: ['first-model', 'second-model'], authenticated: true },
  ] }, { provider: '', model: '', base_url: '' }), {
    provider: 'ready', model: 'first-model', name: 'Ready', baseUrl: '',
  })
})

test('keeps the configured default ahead of the first list entry', () => {
  assert.equal(savedModelFromOptions({ providers: [
    { slug: 'ready', name: 'Ready', models: ['first-model'] },
  ] }, { provider: 'chosen', model: 'default-model', base_url: '' })?.model, 'default-model')
})
