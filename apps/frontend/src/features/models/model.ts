export type ModelProvider = { slug: string; name: string; models: string[]; authenticated?: boolean; auth_type?: string; api_url?: string; is_current?: boolean; is_user_defined?: boolean }
export type ModelOptions = { providers: ModelProvider[]; model?: string; provider?: string }
export type CustomEndpoint = { id: string; name: string; base_url: string; model: string; models: string[]; source: string; is_current: boolean }
export type CustomEndpoints = { endpoints: CustomEndpoint[] }
// Desktop has no login or runtime validation flow for this external ACP process.
export const desktopModelProviderSupported = (slug: string) => slug !== 'copilot-acp'
export const normalizedEndpoint = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()
export type ModelPick = { provider: string; model: string }
export type ModelPickResult = { model?: string; provider?: string; status?: string; confirm_required?: boolean; confirm?: string; confirm_message?: string }
export type ModelAssignment = { ok?: boolean; model?: string; provider?: string; confirm_required?: boolean; confirm_message?: string }
export type SavedModelConfig = { provider: string; model: string; base_url: string }
export type SavedModel = { provider: string; model: string; name: string; baseUrl: string }
export const ADDED_MODELS_KEY = 'hermess.desktop.added-models.v1'
export const MODEL_LISTS_KEY = 'hermess.desktop.model-lists.v1'
export function readAddedModels(storagePath: string): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${ADDED_MODELS_KEY}:${storagePath}`) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, models]) => Array.isArray(models))
      .map(([provider, models]) => [provider, (models as unknown[]).filter((model): model is string => typeof model === 'string' && model.length <= 256)]))
  } catch { return {} }
}
export function readModelLists(storagePath: string): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${MODEL_LISTS_KEY}:${storagePath}`) || '{}')
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
    models: [
      'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428',
      'doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-lite-260215',
      'doubao-seed-1-8-251228', 'doubao-seed-1-6-251015',
      'doubao-seed-1-6-flash-250828', 'doubao-1-5-pro-32k-250115',
      'deepseek-v4-pro-260425', 'deepseek-v4-flash-260425', 'deepseek-v3-2-251201',
    ],
  },
  {
    id: 'volcengine-ark-coding', name: 'ui.volcengine.ark.coding.plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    models: [
      'ark-code-latest', 'doubao-seed-2.0-code', 'doubao-seed-2.0-pro',
      'doubao-seed-2.0-lite', 'doubao-seed-code', 'minimax-m2.5',
      'glm-4.7', 'deepseek-v3.2', 'kimi-k2.5',
    ],
  },
] as const
export function savedModelFromOptions(options: ModelOptions, config: SavedModelConfig): SavedModel | null {
  const provider = (config.provider || '').trim()
  const model = (config.model || options.model || '').trim()
  if (!provider || !model) return null
  const row = options.providers?.find(item => item.is_current && item.slug === provider)
    || options.providers?.find(item => item.is_current && Boolean(item.api_url))
    || options.providers?.find(item => item.slug === provider)
  const baseUrl = config.base_url?.trim() || row?.api_url || ''
  const preset = provider === 'custom'
    ? VOLCENGINE_PRESETS.find(item => item.baseUrl.replace(/\/$/, '').toLowerCase() === baseUrl.replace(/\/$/, '').toLowerCase())
    : undefined
  return { provider, model, name: preset?.name || row?.name || provider, baseUrl }
}
// 固定上游对未配置的提供方只返回空模型列表；这些仅作为离线填写提示。
export const MODEL_FALLBACKS: Record<string, readonly string[]> = {
  'openai-api': ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.4-mini'],
  'openai-codex': ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol'],
  anthropic: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  gemini: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.7-flash', 'gemini-3.1-pro-preview'],
  zai: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-4.7'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  'kimi-coding': ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5'],
  'kimi-coding-cn': ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'],
  stepfun: ['step-3.7-flash', 'step-3.5-flash'],
  minimax: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
  'minimax-cn': ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
  xai: ['grok-4.6', 'grok-build-0.1', 'grok-4.5', 'grok-4.3'],
  'xai-oauth': ['grok-4.6', 'grok-build-0.1', 'grok-4.5'],
  alibaba: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3-coder-plus', 'glm-5.2'],
  'alibaba-cn': ['qwen3.8-max', 'qwen3.7-plus', 'qwen3-coder-plus', 'glm-5.2'],
  'alibaba-coding-plan': ['qwen3.7-plus', 'qwen3.6-plus', 'qwen3-coder-plus', 'kimi-k2.5'],
  'alibaba-coding-plan-cn': ['qwen3.7-plus', 'qwen3.6-plus', 'qwen3-coder-plus', 'kimi-k2.5'],
  'alibaba-token-plan': ['qwen3.8-max-0902', 'qwen3.7-plus', 'deepseek-v4-pro', 'kimi-k2.6'],
  'alibaba-token-plan-cn': ['qwen3.8-max-0902', 'qwen3.7-plus', 'deepseek-v4-pro', 'kimi-k2.6'],
  xiaomi: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.5-pro', 'mimo-v2-flash'],
  'tencent-tokenhub': ['hy4-preview', 'hy3', 'hy3-preview'],
  'tencent-tokenplan': ['hy4-preview', 'hy3', 'hy3-preview'],
  'openrouter': ['anthropic/claude-opus-4.8', 'openai/gpt-6.1-sol', 'deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3'],
  nvidia: ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b', 'z-ai/glm-5.2'],
  'opencode-zen': ['kimi-k3', 'gpt-5.6-sol', 'claude-sonnet-5', 'glm-5.2'],
  'opencode-go': ['kimi-k3', 'glm-5.3', 'minimax-m3', 'deepseek-v4-pro'],
  arcee: ['trinity-large-thinking', 'trinity-large-preview', 'trinity-mini'],
}
