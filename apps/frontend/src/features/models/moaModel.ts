import type { MoaConfig, MoaModelSlot, MoaPreset, ModelProvider } from '@hermess/contracts'

export const emptyMoaSlot = (providers: ModelProvider[] = []): MoaModelSlot => ({
  provider: providers[0]?.slug || '',
  model: providers[0]?.models[0] || '',
  enabled: true,
})
export const emptyMoaPreset = (providers: ModelProvider[] = []): MoaPreset => ({
  enabled: true,
  aggregator: emptyMoaSlot(providers),
  aggregator_temperature: 0.2,
  degraded_reference_policy: 'loud',
  reference_models: [emptyMoaSlot(providers)],
  reference_temperature: 0.4,
  reference_timeout: 120,
  fanout: 'user_turn',
})

export function selectableMoaProviders(providers: ModelProvider[]): ModelProvider[] {
  return providers.filter(provider => provider.slug !== 'moa')
}

export function changeMoaSlotProvider(slot: MoaModelSlot, provider: string, providers: ModelProvider[]): MoaModelSlot {
  return { ...slot, provider, model: providers.find(item => item.slug === provider)?.models[0] || '' }
}

export function resolveMoaSlot(slot: MoaModelSlot, providers: ModelProvider[]): MoaModelSlot {
  const provider = providers.find(item => item.slug === slot.provider)
  if (!provider) return { ...slot, provider: '', model: '' }
  if (!provider.models.includes(slot.model)) return { ...slot, model: '' }
  return slot
}

export function moaPayload(config: MoaConfig): MoaConfig {
  const flattened = config.presets[config.active_preset || config.default_preset]
  if (!flattened) throw new Error('Selected MoA preset does not exist')
  return { ...config, ...flattened }
}

export function moaValidationError(config: MoaConfig): string | null {
  if (!config.default_preset || !config.presets[config.default_preset]) return 'default'
  if (config.active_preset && !config.presets[config.active_preset]) return 'active'
  if (Object.keys(config.presets).length === 0 || Object.keys(config.presets).length > 64) return 'presets'
  for (const [name, preset] of Object.entries(config.presets)) {
    if (!name.trim() || name.length > 128) return 'name'
    const slots = [preset.aggregator, ...preset.reference_models]
    if (!preset.reference_models.length || preset.reference_models.length > 32 || slots.some(slot => !slot.provider.trim() || !slot.model.trim())) return 'slot'
    if (![preset.aggregator_temperature, preset.reference_temperature].every(value => value === null || Number.isFinite(value) && value >= 0 && value <= 2)) return 'temperature'
    if (preset.reference_timeout !== null && (!Number.isFinite(preset.reference_timeout) || preset.reference_timeout <= 0)) return 'timeout'
  }
  return null
}
