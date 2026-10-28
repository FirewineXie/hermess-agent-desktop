import type { ModelOptions, ModelProvider, CustomEndpoint, SavedModelConfig } from '@hermess/contracts'
export type { ModelProvider, ModelOptions, CustomEndpoint, ModelPickResult, ModelAssignment, SavedModelConfig } from '@hermess/contracts'
export type CustomEndpoints = { endpoints: CustomEndpoint[] }
// Desktop has no login or runtime validation flow for this external ACP process.
export const desktopModelProviderSupported = (slug: string) => slug !== 'copilot-acp'
export const normalizedEndpoint = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()
export function endpointForProvider(provider: Pick<ModelProvider, 'slug'>, endpoints: CustomEndpoint[]): CustomEndpoint | undefined {
  return endpoints.find(endpoint => endpoint.id === provider.slug)
}
export type ModelPick = { provider: string; model: string }
export type SavedModel = { provider: string; model: string; name: string; baseUrl: string }
export const ADDED_MODELS_KEY = 'hermess.desktop.added-models.v1'
export const MODEL_LISTS_KEY = 'hermess.desktop.model-lists.v1'
export function appendModelIds(local: string[], discovered: string[]): string[] {
  const result = [...new Set(local)]
  const known = new Set(result)
  for (const candidate of discovered) {
    const id = candidate.trim()
    if (!id || id.length > 256 || /\s/.test(id) || known.has(id)) continue
    result.push(id)
    known.add(id)
  }
  return result
}
export function modelStorageKey(storagePath: string, profile: string): string {
  return profile === 'default' ? storagePath : `${storagePath}:${profile}`
}
export function readAddedModels(storagePath: string, profile = 'default'): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${ADDED_MODELS_KEY}:${modelStorageKey(storagePath, profile)}`) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, models]) => Array.isArray(models))
      .map(([provider, models]) => [provider, (models as unknown[]).filter((model): model is string => typeof model === 'string' && model.length <= 256)]))
  } catch { return {} }
}
export function readModelLists(storagePath: string, profile = 'default'): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${MODEL_LISTS_KEY}:${modelStorageKey(storagePath, profile)}`) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, models]) => Array.isArray(models))
      .map(([provider, models]) => [provider, [...new Set((models as unknown[])
        .filter((model): model is string => typeof model === 'string' && model.trim().length > 0 && model.length <= 256)
        .map(model => model.trim()))]]))
  } catch { return {} }
}
export const VOLCENGINE_PRESETS = [
  {
    id: 'volcengine-ark', name: 'ui.volcengine.ark.pay.as.you.go.api',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '',
  },
  {
    id: 'volcengine-ark-coding', name: 'ui.volcengine.ark.coding.plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    defaultModel: 'ark-code-latest',
  },
] as const
export function savedModelFromOptions(options: ModelOptions, config: SavedModelConfig): SavedModel | null {
  const provider = (config.provider || options.provider || '').trim()
  const model = (config.model || options.model || '').trim()
  if (!model) {
    const first = options.providers?.find(item => desktopModelProviderSupported(item.slug)
      && item.authenticated !== false && item.models.some(candidate => candidate.trim()))
    const firstModel = first?.models.find(candidate => candidate.trim())?.trim()
    return first && firstModel
      ? { provider: first.slug, model: firstModel, name: first.name, baseUrl: first.api_url || '' }
      : null
  }
  const row = options.providers?.find(item => item.is_current && item.slug === provider)
    || options.providers?.find(item => item.slug === provider)
    || (provider === 'custom' ? options.providers?.find(item => item.is_current && Boolean(item.api_url)) : undefined)
  const baseUrl = config.base_url?.trim() || row?.api_url || ''
  const preset = provider === 'custom'
    ? VOLCENGINE_PRESETS.find(item => item.baseUrl.replace(/\/$/, '').toLowerCase() === baseUrl.replace(/\/$/, '').toLowerCase())
    : undefined
  return { provider, model, name: preset?.name || row?.name || provider, baseUrl }
}
