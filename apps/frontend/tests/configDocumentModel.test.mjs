import test from 'node:test'
import assert from 'node:assert/strict'
import { isConfigDocument, resetConfigFields } from '../src/features/configuration/configDocumentModel.ts'

test('config document accepts only JSON-style root objects', () => {
  assert.equal(isConfigDocument({ agent: {} }), true)
  assert.equal(isConfigDocument([]), false)
  assert.equal(isConfigDocument(null), false)
})

test('scoped reset changes only selected fields and does not mutate inputs', () => {
  const config = { agent: { reasoning_effort: 'high', service_tier: 'priority' }, display: { language: 'zh-CN' } }
  const defaults = { agent: { reasoning_effort: 'medium', service_tier: 'auto' }, display: { language: 'en-US' } }
  const next = resetConfigFields(config, defaults, ['agent.reasoning_effort', 'display.language'])
  assert.deepEqual(next, { agent: { reasoning_effort: 'medium', service_tier: 'priority' }, display: { language: 'en-US' } })
  assert.deepEqual(config, { agent: { reasoning_effort: 'high', service_tier: 'priority' }, display: { language: 'zh-CN' } })
})

test('scoped reset removes a field that has no default', () => {
  assert.deepEqual(resetConfigFields({ custom: { value: 1, keep: true } }, {}, ['custom.value']), { custom: { keep: true } })
})
