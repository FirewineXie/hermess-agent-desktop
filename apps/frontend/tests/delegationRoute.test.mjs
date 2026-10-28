import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRouteOverrides, routeFallbacks, updateModelRoute } from '../src/features/models/delegationRoute.ts'

test('renaming a route keeps its credential origin and follows the default selection', () => {
  const routing = {
    model_map: {
      default: 'review',
      options: [{ name: 'review', description: 'Review code', model: 'model-a', api_key: 'masked-preview', fallback_providers: [{ provider: 'backup' }] }],
    },
  }
  const renamed = updateModelRoute(routing, 0, { name: 'deep-review' })
  assert.equal(renamed.model_map.default, 'deep-review')
  assert.deepEqual(renamed.model_map.options[0], {
    name: 'deep-review', original_name: 'review', description: 'Review code', model: 'model-a',
    api_key: 'masked-preview', fallback_providers: [{ provider: 'backup' }],
  })
  const renamedAgain = updateModelRoute(renamed, 0, { name: 'final-review' })
  assert.equal(renamedAgain.model_map.options[0].original_name, 'review')
  assert.equal(renamedAgain.model_map.default, 'final-review')
})

test('editing a route leaves other routes and their advanced fields untouched', () => {
  const second = { name: 'quick', description: 'Fast tasks', model: 'model-b', service_tier: 'fast' }
  const routing = { model_map: { default: null, options: [{ name: 'review', description: 'Review', model: 'model-a' }, second] } }
  const updated = updateModelRoute(routing, 0, { base_url: 'https://model.example/v1', api_mode: 'chat_completions' })
  assert.deepEqual(updated.model_map.options[1], second)
  assert.equal(updated.model_map.options[0].base_url, 'https://model.example/v1')
  assert.equal(updated.model_map.options[0].api_mode, 'chat_completions')
})

test('normalizes legacy fallback entries while preserving extra route fields', () => {
  assert.deepEqual(routeFallbacks([{ provider: 'custom', model: 'model-a', base_url: 'https://example.com/v1' }, 'openai/model-b']), [
    { provider: 'custom', model: 'model-a', base_url: 'https://example.com/v1' },
    { provider: 'openai', model: 'model-b' },
  ])
})

test('request overrides accept only JSON objects', () => {
  assert.deepEqual(parseRouteOverrides('{"extra_body":{"speed":"fast"}}'), { extra_body: { speed: 'fast' } })
  assert.deepEqual(parseRouteOverrides(''), {})
  assert.equal(parseRouteOverrides('['), null)
  assert.equal(parseRouteOverrides('[]'), null)
  assert.equal(parseRouteOverrides('null'), null)
})
