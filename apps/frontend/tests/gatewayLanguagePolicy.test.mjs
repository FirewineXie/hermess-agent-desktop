import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gatewayLanguageDecision } from '../src/features/runtime/gatewayLanguagePolicy.ts'

test('unset Profile language follows the desktop language', () => {
  assert.equal(gatewayLanguageDecision(undefined, null, 'zh'), 'write')
  assert.equal(gatewayLanguageDecision(undefined, null, 'en'), 'same')
})

test('a product-managed language follows later changes', () => {
  assert.equal(gatewayLanguageDecision('zh', 'zh', 'en'), 'write')
  assert.equal(gatewayLanguageDecision('en', 'en', 'zh'), 'write')
  assert.equal(gatewayLanguageDecision('zh', 'zh', 'zh'), 'same')
})

test('an explicit Profile language remains independent', () => {
  assert.equal(gatewayLanguageDecision('en', null, 'zh'), 'preserve')
  assert.equal(gatewayLanguageDecision('en', 'zh', 'zh'), 'preserve')
})
