import assert from 'node:assert/strict'
import test from 'node:test'
import { changeMoaSlotProvider, emptyMoaPreset, moaPayload, moaValidationError, resolveMoaSlot, selectableMoaProviders } from '../src/features/models/moaModel.ts'

function config() {
  const preset = emptyMoaPreset()
  preset.aggregator = { provider: 'openai', model: 'gpt-5', enabled: true }
  preset.reference_models = [{ provider: 'anthropic', model: 'claude', enabled: true }]
  return { ...preset, default_preset: 'default', active_preset: 'default', presets: { default: preset } }
}

test('builds the wire payload from the active preset', () => {
  const value = config()
  value.presets.second = { ...value.presets.default, aggregator_temperature: 0.7 }
  value.active_preset = 'second'
  assert.equal(moaPayload(value).aggregator_temperature, 0.7)
  value.active_preset = ''
  assert.equal(moaPayload(value).aggregator_temperature, 0.2)
})

test('validates preset references and model slots', () => {
  assert.equal(moaValidationError(config()), null)
  const inactive = config(); inactive.active_preset = ''
  assert.equal(moaValidationError(inactive), null)
  const missing = config(); missing.active_preset = 'unknown'
  assert.equal(moaValidationError(missing), 'active')
  const slot = config(); slot.presets.default.reference_models[0].model = ''
  assert.equal(moaValidationError(slot), 'slot')
})

test('uses configured providers and selects the first model when its provider changes', () => {
  const providers = selectableMoaProviders([
    { slug: 'openrouter', name: 'OpenRouter', models: ['anthropic/claude-opus-4.8'] },
    { slug: 'moa', name: 'MoA', models: ['default'] },
  ])
  assert.deepEqual(providers.map(provider => provider.slug), ['openrouter'])
  assert.deepEqual(
    changeMoaSlotProvider({ provider: 'openai-codex', model: 'gpt-5.5', enabled: true }, 'openrouter', providers),
    { provider: 'openrouter', model: 'anthropic/claude-opus-4.8', enabled: true },
  )
  assert.deepEqual(
    resolveMoaSlot({ provider: 'missing', model: 'legacy-model', enabled: true }, providers),
    { provider: '', model: '', enabled: true },
  )
  assert.deepEqual(
    resolveMoaSlot({ provider: 'openrouter', model: 'legacy-model', enabled: true }, providers),
    { provider: 'openrouter', model: '', enabled: true },
  )
})
