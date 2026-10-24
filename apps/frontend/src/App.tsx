import React from 'react'
import type { BackendInfo } from '@hermess/contracts'
import commandDescriptionsZh from './locales/app/command-descriptions.zh-CN.json'
import './style.css'
import AgentSettingsView from './features/agent-settings/AgentSettingsView'
import { useLanguage, translateApp, localizeAppMessage } from './i18n'
import { useDesktop } from './app/DesktopContext'
import ToolsView from './features/tools/ToolsView'
import RuntimeView from './features/runtime/RuntimeView'
import Sidebar from './app/Sidebar'
import WorkspaceHeader from './app/WorkspaceHeader'
import type { View, SessionRow } from './app/types'

type GatewayEvent = { kind: string; session_id?: string; seq?: number; payload: Record<string, unknown> }
type ReplayResult = { events: Array<{ type: string; session_id?: string; seq?: number; payload?: Record<string, unknown> }>; latest_seq: number; epoch: string; truncated: boolean; open_requests?: GatewayRequest[] }
type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
type GatewayRequest = {
  id: string
  method: 'approval' | 'clarify'
  params: {
    session_id?: string
    command?: string
    description?: string
    tool_name?: string
    choices?: ApprovalChoice[]
    questions?: Array<{ qid: string; question: string; choices?: string[] }>
  }
}
type ModelProvider = { slug: string; name: string; models: string[]; authenticated?: boolean; auth_type?: string; api_url?: string; is_current?: boolean; is_user_defined?: boolean }
type ModelOptions = { providers: ModelProvider[]; model?: string; provider?: string }
type CustomEndpoint = { id: string; name: string; base_url: string; model: string; models: string[]; source: string; is_current: boolean }
type CustomEndpoints = { endpoints: CustomEndpoint[] }
// Desktop has no login or runtime validation flow for this external ACP process.
const desktopModelProviderSupported = (slug: string) => slug !== 'copilot-acp'
const normalizedEndpoint = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()
type ModelPick = { provider: string; model: string }
type ModelPickResult = { model?: string; provider?: string; status?: string; confirm_required?: boolean; confirm?: string; confirm_message?: string }
type ModelAssignment = { ok?: boolean; model?: string; provider?: string; confirm_required?: boolean; confirm_message?: string }
type SavedModelConfig = { provider: string; model: string; base_url: string }
type SavedModel = { provider: string; model: string; name: string; baseUrl: string }
const ADDED_MODELS_KEY = 'hermess.desktop.added-models.v1'
const MODEL_LISTS_KEY = 'hermess.desktop.model-lists.v1'
function readAddedModels(storagePath: string): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${ADDED_MODELS_KEY}:${storagePath}`) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, models]) => Array.isArray(models))
      .map(([provider, models]) => [provider, (models as unknown[]).filter((model): model is string => typeof model === 'string' && model.length <= 256)]))
  } catch { return {} }
}
function readModelLists(storagePath: string): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${MODEL_LISTS_KEY}:${storagePath}`) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, models]) => Array.isArray(models))
      .map(([provider, models]) => [provider, [...new Set((models as unknown[])
        .filter((model): model is string => typeof model === 'string' && model.trim().length > 0 && model.length <= 256)
        .map(model => model.trim()))]]))
  } catch { return {} }
}
const VOLCENGINE_PRESETS = [
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
function savedModelFromOptions(options: ModelOptions, config: SavedModelConfig): SavedModel | null {
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
const MODEL_FALLBACKS: Record<string, readonly string[]> = {
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
type PendingAttachment = { kind: 'image' | 'file'; name: string; source_path: string; bytes: number; preview?: string; path?: string; ref_text?: string }
type CommandCatalog = {
  pairs: Array<[string, string]>
  skills: Record<string, { usage: number; origin: string }>
  commands: Record<string, { desktop?: string | null }>
  categories?: Array<{ name: string; pairs: Array<[string, string]> }>
  plugin_commands?: Record<string, string>
  warning?: string
}
type CommandResult = { type?: string; output?: string; message?: string; display?: string; notice?: string }
type ComposerChoice = { name: string; description: string; skill: boolean; available: boolean; availability: string }
const DESKTOP_GATEWAY_COMMANDS = new Set([
  'help', 'status', 'context', 'version', 'whoami', 'usage', 'insights', 'profile', 'diff',
  'memory', 'kanban', 'topup', 'suggestions', 'bundles', 'skills', 'title', 'goal', 'subgoal',
  'loop', 'heartbeat', 'review', 'refine', 'debug', 'curator', 'login', 'autoprune',
  'plan', 'learn', 'init', 'moa', 'blueprint', 'egress', 'reasoning', 'voice', 'approvals',
  'codex-runtime', 'footer', 'busy', 'verbose', 'yolo', 'fast', 'personality',
  'approve', 'deny', 'platforms', 'new', 'sessions', 'model',
])

function commandSupported(catalog: CommandCatalog, name: string): boolean {
  if (Object.hasOwn(catalog.skills, name) || DESKTOP_GATEWAY_COMMANDS.has(name.slice(1))) return true
  if (Object.hasOwn(catalog.plugin_commands || {}, name.slice(1))) return true
  return Boolean(catalog.categories?.some(category =>
    category.name === 'User commands' && category.pairs.some(([key]) => key === name)))
}

function commandAvailability(catalog: CommandCatalog, name: string, language: 'zh-CN' | 'en-US'): string {
  if (commandSupported(catalog, name)) return translateApp(language, "ui.available")
  const desktop = catalog.commands[name]?.desktop
  if (desktop === 'terminal') return translateApp(language, "ui.terminal.only")
  if (desktop === 'settings') return translateApp(language, "ui.use.the.settings.page")
  return translateApp(language, "ui.not.available.in.the.desktop.app")
}

function composerTrigger(draft: string, caret: number) {
  const position = Math.min(Math.max(caret, 0), draft.length)
  const match = /(^|\s)([\/@])([^\s]*)$/.exec(draft.slice(0, position))
  if (!match) return null
  const start = position - match[2].length - match[3].length
  if (match[2] === '/' && start !== 0) return null
  return { prefix: match[2], query: match[3], start, end: position }
}

function commandChoices(catalog: CommandCatalog, trigger: NonNullable<ReturnType<typeof composerTrigger>>, language: 'zh-CN' | 'en-US'): ComposerChoice[] {
  const { prefix, query } = trigger
  return catalog.pairs.flatMap(([name, description]) => {
    const skill = Object.hasOwn(catalog.skills, name)
    if (prefix === '@' && !skill) return []
    if (!name.slice(1).toLowerCase().includes(query.toLowerCase())) return []
    const localized = language === 'zh-CN' ? commandDescriptionsZh[name as keyof typeof commandDescriptionsZh] : undefined
    const modelDescription = name === '/model'
      ? translateApp(language, "ui.open.model.settings.saved.defaults.apply.to.new.sessions")
      : undefined
    return [{
      name: prefix === '@' ? `@${name.slice(1)}` : name,
      description: modelDescription || localized || description,
      skill,
      available: commandSupported(catalog, name),
      availability: commandAvailability(catalog, name, language),
    }]
  })
}
type ResumeResult = {
  session_id: string
  info?: { provider?: string; model?: string }
  stored_session_id?: string
  session_key?: string
  messages: Array<{ role: string; text?: string | null }>
  running?: boolean
  replay_epoch?: string
  last_sequence?: number
  inflight?: { assistant?: string; user?: string }
  open_requests?: GatewayRequest[]
}

type ChatUsage = { context_tokens?: number; last_prompt_tokens?: number; context_length?: number; context_used?: number; context_max?: number; context_percent?: number; context_source?: string; context_estimated?: boolean }

function contextPercent(usage: ChatUsage | null): number | null {
  if (!usage) return null
  const used = usage.context_used ?? usage.context_tokens ?? usage.last_prompt_tokens
  const maximum = usage.context_max ?? usage.context_length
  if (used == null || !Number.isFinite(used) || !maximum || !Number.isFinite(maximum) || maximum <= 0) return null
  return Math.max(0, Math.min(100, Math.round(used / maximum * 100)))
}

function contextLabel(usage: ChatUsage | null, language: 'zh-CN' | 'en-US'): string {
  const percent = contextPercent(usage)
  if (percent === null) return language === 'zh-CN' ? '上下文 —' : 'Context —'
  const estimated = usage?.context_estimated || (usage?.context_source && usage.context_source !== 'provider_usage')
  return `${language === 'zh-CN' ? '上下文' : 'Context'} ${estimated ? '≈' : ''}${percent}%`
}

function App() {
  const { invoke, listen, open, onDragDropEvent, runtime, diagnostics } = useDesktop()
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(languageRef.current, key, ...values), [])
  const [view, setView] = React.useState<View>('chat')
  const [agentConfigDirty, setAgentConfigDirty] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [pythonPath, setPythonPath] = React.useState('')
  const [storagePath, setStoragePath] = React.useState('')
  const [storageLocked, setStorageLocked] = React.useState(false)
  const [backend, setBackend] = React.useState<BackendInfo | null>(null)
  const [backendStatus, setBackendStatus] = React.useState(t("ui.not.started"))
  const [busy, setBusy] = React.useState(false)
  const [sessionId, setSessionId] = React.useState('')
  const [reasoningEffort, setReasoningEffort] = React.useState('')
  const [reasoningBusy, setReasoningBusy] = React.useState(false)
  const [chatUsage, setChatUsage] = React.useState<ChatUsage | null>(null)
  const sessionRef = React.useRef('')
  const storedSessionRef = React.useRef('')
  const [draft, setDraft] = React.useState('')
  const [commandCatalog, setCommandCatalog] = React.useState<CommandCatalog | null>(null)
  const [commandCatalogError, setCommandCatalogError] = React.useState('')
  const [activeChoice, setActiveChoice] = React.useState(0)
  const [draftCaret, setDraftCaret] = React.useState(0)
  const commandCatalogPromiseRef = React.useRef<Promise<CommandCatalog> | null>(null)
  const draftInputRef = React.useRef<HTMLTextAreaElement>(null)
  const [conversation, setConversation] = React.useState<Array<{ role: string; text: string }>>([])
  const [assistant, setAssistant] = React.useState('')
  const assistantRef = React.useRef('')
  const [chatStatus, setChatStatus] = React.useState('')
  const [turnBusy, setTurnBusy] = React.useState(false)
  const [serverRequests, setServerRequests] = React.useState<GatewayRequest[]>([])
  const serverRequest = serverRequests[0] || null
  const [clarifyAnswers, setClarifyAnswers] = React.useState<Record<string, string>>({})
  const [sessions, setSessions] = React.useState<SessionRow[]>([])
  const [modelProviders, setModelProviders] = React.useState<ModelProvider[]>([])
  const [configuredProviders, setConfiguredProviders] = React.useState<ModelProvider[]>([])
  const [customEndpoints, setCustomEndpoints] = React.useState<CustomEndpoint[]>([])
  const [addingProvider, setAddingProvider] = React.useState(false)
  const [newProviderPreset, setNewProviderPreset] = React.useState('')
  const [providerFormError, setProviderFormError] = React.useState('')
  const [newProviderName, setNewProviderName] = React.useState('')
  const [newProviderUrl, setNewProviderUrl] = React.useState('')
  const [newProviderModel, setNewProviderModel] = React.useState('')
  const [modelSuggestionsOpen, setModelSuggestionsOpen] = React.useState(false)
  const [modelSuggestionQuery, setModelSuggestionQuery] = React.useState('')
  const [newProviderKey, setNewProviderKey] = React.useState('')
  const [modelFormOpen, setModelFormOpen] = React.useState(false)
  const [modelProvider, setModelProvider] = React.useState('')
  const [modelName, setModelName] = React.useState('')
  const [modelBaseUrl, setModelBaseUrl] = React.useState('')
  const [modelKey, setModelKey] = React.useState('')
  const [modelBusy, setModelBusy] = React.useState(false)
  const [modelStatus, setModelStatus] = React.useState('')
  const [modelConfirmation, setModelConfirmation] = React.useState('')
  const [modelOptionsLoaded, setModelOptionsLoaded] = React.useState(false)
  const [modelOptionsError, setModelOptionsError] = React.useState('')
  const [savedModel, setSavedModel] = React.useState<SavedModel | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false)
  const modelButtonRef = React.useRef<HTMLButtonElement>(null)
  const modelPickerRef = React.useRef<HTMLDivElement>(null)
  const [pickerPosition, setPickerPosition] = React.useState<React.CSSProperties>({})
  const [pickerProviders, setPickerProviders] = React.useState<ModelProvider[]>([])
  const [pickerProvider, setPickerProvider] = React.useState('')
  const [pickerModelInput, setPickerModelInput] = React.useState('')
  const [pickerBusy, setPickerBusy] = React.useState(false)
  const [pickerError, setPickerError] = React.useState('')
  const [pickerConfirmation, setPickerConfirmation] = React.useState<{ provider: string; model: string; remember: boolean; token: string; message: string } | null>(null)
  const [activeModel, setActiveModel] = React.useState<ModelPick | null>(null)
  const [addedModels, setAddedModels] = React.useState<Record<string, string[]>>({})
  const [modelLists, setModelLists] = React.useState<Record<string, string[]>>({})
  const [modelListBusy, setModelListBusy] = React.useState(false)
  const [modelListLoading, setModelListLoading] = React.useState(true)
  const [editingModel, setEditingModel] = React.useState<{ provider: string; original: string; value: string } | null>(null)
  const [addingModelProvider, setAddingModelProvider] = React.useState('')
  const [newModelId, setNewModelId] = React.useState('')
  React.useEffect(() => {
    setAddedModels(readAddedModels(storagePath))
    const legacyLists = readModelLists(storagePath)
    setModelLists(legacyLists)
    setEditingModel(null)
    setAddingModelProvider('')
    if (!storagePath) return
    let active = true
    setModelListLoading(true)
    void invoke<Record<string, string[]> | null>('load_model_lists', { storagePath }).then(saved => {
      if (!active) return
      if (saved !== null) setModelLists(saved)
      else if (Object.keys(legacyLists).length) return invoke('save_model_lists', { storagePath, lists: legacyLists })
    }).catch(cause => { if (active) setModelStatus(t('ui.failed.to.save.provider.models.arg', String(cause))) })
      .finally(() => { if (active) setModelListLoading(false) })
    return () => { active = false }
  }, [storagePath])
  const selectedPreset = VOLCENGINE_PRESETS.find(preset => preset.id === modelProvider)
  function savedCandidates(slug: string, providers: ModelProvider[]): string[] | undefined {
    const row = providers.find(provider => provider.slug === slug)
    const endpoint = customEndpoints.find(item => item.id === slug
      || (row?.api_url && normalizedEndpoint(item.base_url) === normalizedEndpoint(row.api_url)))
    return modelLists[endpoint?.id || slug] ?? modelLists[slug]
      ?? (endpoint ? modelLists[`custom:${endpoint.name.toLowerCase().replace(/\s+/g, '-')}`] : undefined)
  }
  const backendCandidates = modelProviders.find(provider => provider.slug === modelProvider)?.models || []
  const fallbackCandidates = selectedPreset?.models || MODEL_FALLBACKS[modelProvider] || []
  const modelCandidates = savedCandidates(modelProvider, modelProviders) ?? [...new Set([...(backendCandidates.length > 0 ? backendCandidates : fallbackCandidates), ...(addedModels[modelProvider] || [])])]
  const pickerModels = savedCandidates(pickerProvider, pickerProviders) ?? [...new Set([...(pickerProviders.find(row => row.slug === pickerProvider)?.models || []), ...(addedModels[pickerProvider] || [])])]
  const newProviderPresetModels = newProviderPreset.startsWith('preset:')
    ? VOLCENGINE_PRESETS.find(preset => `preset:${preset.id}` === newProviderPreset)?.models || []
    : (() => {
      const models = modelProviders.find(provider => provider.slug === newProviderPreset)?.models || []
      return models.length ? models : MODEL_FALLBACKS[newProviderPreset] || []
    })()
  const visibleProviderModels = newProviderPresetModels.filter(model => model.toLowerCase().includes(modelSuggestionQuery.toLowerCase()))
  const savedPreset = savedModel?.provider === 'custom'
    ? VOLCENGINE_PRESETS.find(preset => normalizedEndpoint(preset.baseUrl) === normalizedEndpoint(savedModel.baseUrl))
    : undefined
  const providerCards = configuredProviders
    .filter(provider => desktopModelProviderSupported(provider.slug) && (provider.slug !== 'custom' || !savedPreset))
    .map(provider => ({ slug: provider.slug, name: provider.name, api_url: provider.api_url || '', is_user_defined: Boolean(provider.is_user_defined), models: provider.models.length ? provider.models : [...(MODEL_FALLBACKS[provider.slug] || [])] }))
  if (savedModel && desktopModelProviderSupported(savedModel.provider)
    && !providerCards.some(provider => provider.slug === (savedPreset?.id || savedModel.provider)
      || (savedModel.baseUrl && normalizedEndpoint(provider.api_url) === normalizedEndpoint(savedModel.baseUrl)))
    && !customEndpoints.some(endpoint => endpoint.source !== 'direct-config' && savedModel.baseUrl && normalizedEndpoint(endpoint.base_url) === normalizedEndpoint(savedModel.baseUrl))) {
    providerCards.unshift({ slug: savedPreset?.id || savedModel.provider, name: t(savedModel.name), api_url: savedModel.baseUrl, is_user_defined: savedModel.provider === 'custom', models: savedPreset ? [...savedPreset.models] : [savedModel.model] })
  }
  for (const endpoint of customEndpoints) {
    if (endpoint.source === 'direct-config' || providerCards.some(provider => provider.slug === endpoint.id || (provider.api_url && normalizedEndpoint(provider.api_url) === normalizedEndpoint(endpoint.base_url)))) continue
    providerCards.push({ slug: endpoint.id, name: endpoint.name, api_url: endpoint.base_url, is_user_defined: true, models: endpoint.models.length ? endpoint.models : [endpoint.model] })
  }

  React.useEffect(() => {
    if (!addingProvider) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !modelBusy) setAddingProvider(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [addingProvider, modelBusy])

  const positionModelPicker = React.useCallback(() => {
    const button = modelButtonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const width = Math.min(340, window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
    const above = rect.top - 12
    const below = window.innerHeight - rect.bottom - 12
    setPickerPosition(above >= 260 || above >= below
      ? { left, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(390, Math.max(120, above - 8)) }
      : { left, top: rect.bottom + 8, maxHeight: Math.min(390, Math.max(120, below - 8)) })
  }, [])

  React.useEffect(() => {
    if (!modelPickerOpen) return
    positionModelPicker()
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!modelPickerRef.current?.contains(target) && !modelButtonRef.current?.contains(target)) setModelPickerOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setModelPickerOpen(false) }
    window.addEventListener('resize', positionModelPicker)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', positionModelPicker)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [modelPickerOpen, positionModelPicker])
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([])
  const [attachmentBusy, setAttachmentBusy] = React.useState(false)
  const [draggingFiles, setDraggingFiles] = React.useState(false)
  const lastSeqRef = React.useRef<Record<string, number>>({})
  const epochRef = React.useRef<Record<string, string>>({})
  const recoveringRef = React.useRef(false)
  const bufferedEventsRef = React.useRef<GatewayEvent[]>([])
  const bufferedRequestsRef = React.useRef<GatewayRequest[]>([])
  const eventProcessorRef = React.useRef<(data: GatewayEvent) => void>(() => {})

  eventProcessorRef.current = data => {
    const id = data.session_id
    if (!id || id !== sessionRef.current) return
    if (typeof data.seq === 'number') {
      if (data.seq <= (lastSeqRef.current[id] || 0)) return
      lastSeqRef.current[id] = data.seq
    }
    if (data.kind === 'message.delta' && typeof data.payload?.text === 'string') {
      assistantRef.current += data.payload.text
      setAssistant(assistantRef.current)
    } else if (data.kind === 'message.complete') {
      const usage = data.payload?.usage
      if (usage && typeof usage === 'object' && ('context_used' in usage || 'context_max' in usage)) {
        setChatUsage(usage as ChatUsage)
      } else {
        void invoke<ChatUsage>('get_chat_usage', { sessionId: id }).then(result => {
          if (sessionRef.current === id) setChatUsage(result)
        }).catch(() => {})
      }
      const text = typeof data.payload?.text === 'string' ? data.payload.text : ''
      setConversation(rows => [...rows, { role: 'assistant', text: text || assistantRef.current }])
      assistantRef.current = ''
      setAssistant('')
      setTurnBusy(false)
      setChatStatus(data.payload?.status === 'error' ? String(data.payload?.error || t("ui.response.failed")) : t("ui.response.complete"))
      void loadSessions(true)
    } else if (data.kind === 'error') {
      setChatStatus(String(data.payload?.message || t("ui.backend.error")))
      setTurnBusy(false)
    } else if (data.kind === 'tool.start' || data.kind === 'tool.complete') {
      setChatStatus(t("ui.arg.arg", t(data.kind === 'tool.start' ? 'ui.calling' : 'ui.tool.finished'), String(data.payload?.name || t("ui.tool"))))
    } else if (data.kind === 'request.cancel') {
      setServerRequests(current => current.filter(request => request.id !== data.payload?.id))
    }
  }

  React.useEffect(() => {
    let active = true
    setBusy(true)
    setBackendStatus(t("ui.reading.startup.configuration"))
    void (async () => {
      try {
        if (import.meta.env.DEV) {
          const defaults = await runtime.devDefaults()
          if (!active) return
          setPythonPath(defaults.python_path)
          setStoragePath(defaults.storage_path)
          await startBackend(defaults.storage_path, defaults.python_path)
        } else {
          const defaults = await runtime.packedDefaults()
          if (!active) return
          setStoragePath(defaults.storage_path)
          setStorageLocked(defaults.initialized)
          await startBackend(defaults.storage_path)
        }
      } catch (cause) {
        if (active) {
          setBackendStatus(t("ui.failed.to.read.startup.configuration.arg", String(cause)))
          setBusy(false)
        }
      }
    })()
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    let active = true
    let unlistenEvent: (() => void) | undefined
    let unlistenDisconnect: (() => void) | undefined
    let unlistenRequest: (() => void) | undefined
    void listen<GatewayEvent>('hermes-event', event => {
      const data = event.payload
      if (!active) return
      if (recoveringRef.current) bufferedEventsRef.current.push(data)
      else eventProcessorRef.current(data)
    }).then(fn => { if (active) unlistenEvent = fn; else fn() })
    void listen<GatewayRequest>('hermes-request', event => {
      if (active && recoveringRef.current) bufferedRequestsRef.current.push(event.payload)
      else if (active && event.payload.params.session_id === sessionRef.current) {
        setServerRequests(current => current.some(request => request.id === event.payload.id) ? current : [...current, event.payload])
      }
    }).then(fn => { if (active) unlistenRequest = fn; else fn() })
    void listen('hermes-disconnected', () => {
      if (active) { setChatStatus(t("ui.connection.interrupted.please.check.the.connection.before.resuming.the.sess")); setTurnBusy(false); setServerRequests([]) }
    }).then(fn => { if (active) unlistenDisconnect = fn; else fn() })
    return () => { active = false; unlistenEvent?.(); unlistenRequest?.(); unlistenDisconnect?.() }
  }, [])

  async function answerRequest(choice?: ApprovalChoice) {
    if (!serverRequest) return
    const request = serverRequest
    try {
      await invoke('answer_gateway_request', {
        requestId: request.id,
        method: request.method,
        choice,
        answers: request.method === 'clarify' ? clarifyAnswers : undefined,
      })
      setServerRequests(current => current.filter(item => item.id !== request.id))
      setClarifyAnswers({})
      setChatStatus(request.method === 'approval' ? t("ui.approval.decision.submitted") : t("ui.clarification.answer.submitted"))
    } catch (cause) { setChatStatus(t("ui.failed.to.process.request.arg", String(cause))) }
  }

  async function ensureChatSession() {
    if (sessionRef.current) return sessionRef.current
    const created = await invoke<{ session_id: string; stored_session_id: string; info?: { provider?: string; model?: string } }>('create_chat_session')
    const id = created.session_id
    sessionRef.current = id
    epochRef.current[id] = backend?.replay_epoch || ''
    lastSeqRef.current[id] = 0
    storedSessionRef.current = created.stored_session_id
    setSessionId(id)
    setActiveModel(created.info?.provider && created.info.model ? { provider: created.info.provider, model: created.info.model } : null)
    return id
  }

  React.useEffect(() => {
    if (!backend || !sessionId) {
      setReasoningEffort('')
      setChatUsage(null)
      return
    }
    let active = true
    void Promise.allSettled([
      invoke<{ value?: string }>('get_chat_reasoning', { sessionId }),
      invoke<ChatUsage>('get_chat_usage', { sessionId }),
    ]).then(([reasoning, usage]) => {
      if (!active || sessionRef.current !== sessionId) return
      if (reasoning.status === 'fulfilled') setReasoningEffort(reasoning.value.value || '')
      if (usage.status === 'fulfilled') setChatUsage(usage.value)
    })
    return () => { active = false }
  }, [backend, sessionId, activeModel?.provider, activeModel?.model])

  async function changeReasoning(value: string) {
    if (reasoningBusy || !backend) return
    setReasoningBusy(true)
    try {
      const id = await ensureChatSession()
      await invoke('execute_composer_command', { sessionId: id, command: `/reasoning ${value || 'reset'}` })
      const current = await invoke<{ value?: string }>('get_chat_reasoning', { sessionId: id })
      if (sessionRef.current === id) setReasoningEffort(current.value || '')
      setChatStatus(language === 'zh-CN' ? '思考强度已更新，下轮回答生效' : 'Reasoning effort updated for the next turn')
    } catch (cause) { setChatStatus(String(cause)) }
    finally { setReasoningBusy(false) }
  }

  function loadCommandCatalog(): Promise<CommandCatalog> {
    if (commandCatalog) return Promise.resolve(commandCatalog)
    if (!commandCatalogPromiseRef.current) {
      commandCatalogPromiseRef.current = ensureChatSession()
        .then(id => invoke<CommandCatalog>('list_composer_commands', { sessionId: id }))
        .then(catalog => {
          setCommandCatalog(catalog)
          setCommandCatalogError(catalog.warning || '')
          return catalog
        })
        .catch(cause => {
          commandCatalogPromiseRef.current = null
          setCommandCatalogError(t("ui.command.directory.read.failed.arg", String(cause)))
          throw cause
        })
    }
    return commandCatalogPromiseRef.current
  }

  React.useEffect(() => {
    if (backend && composerTrigger(draft, draftCaret) && !commandCatalog) {
      void loadCommandCatalog().catch(() => {})
    }
  }, [backend, draft, draftCaret, commandCatalog])

  const trigger = composerTrigger(draft, draftCaret)
  const choices = commandCatalog && trigger ? commandChoices(commandCatalog, trigger, language) : []
  function chooseCommand(choice: ComposerChoice) {
    if (!trigger) return
    if (!choice.available) { setChatStatus(`${choice.name}：${choice.availability}`); return }
    const replacement = `${choice.name} `
    const caret = trigger.start + replacement.length
    setDraft(`${draft.slice(0, trigger.start)}${replacement}${draft.slice(trigger.end)}`)
    setDraftCaret(caret)
    setActiveChoice(0)
    requestAnimationFrame(() => {
      draftInputRef.current?.focus()
      draftInputRef.current?.setSelectionRange(caret, caret)
    })
  }

  async function addAttachments(paths: string[]) {
    if (!backend || turnBusy || attachmentBusy) return
    if (paths.length + attachments.length > 10) { setChatStatus(t("ui.up.to.10.attachments.can.be.temporarily.saved.per.round")); return }
    setAttachmentBusy(true)
    try {
      const id = await ensureChatSession()
      const existing = new Set(attachments.map(item => item.source_path))
      for (const path of paths) {
        if (existing.has(path)) continue
        const attached = await invoke<PendingAttachment>('attach_chat_file', { sessionId: id, path })
        setAttachments(current => [...current, attached])
        existing.add(attached.source_path)
      }
      setChatStatus(t("ui.arg.attachments.staged.they.will.be.included.with.the.next.message", paths.length))
    } catch (cause) { setChatStatus(t("ui.failed.to.temporarily.save.attachment.arg", String(cause))) }
    finally { setAttachmentBusy(false) }
  }

  async function chooseAttachments() {
    try {
      const selected = await open({ directory: false, multiple: true, title: t("ui.select.attachments.no.more.than.20.mib.each") })
      if (selected) await addAttachments(Array.isArray(selected) ? selected : [selected])
    } catch (cause) { setChatStatus(t("ui.failed.to.select.attachment.arg", String(cause))) }
  }

  React.useEffect(() => {
    if (!backend) return
    let active = true
    let unlisten: (() => void) | undefined
    void onDragDropEvent(event => {
      if (!active) return
      if (event.payload.type === 'enter') setDraggingFiles(true)
      if (event.payload.type === 'leave') setDraggingFiles(false)
      if (event.payload.type === 'drop') {
        setDraggingFiles(false)
        void addAttachments(event.payload.paths)
      }
    }).then(fn => { if (active) unlisten = fn; else fn() })
      .catch(cause => setChatStatus(t("ui.file.drag.in.monitoring.failed.arg", String(cause))))
    return () => { active = false; unlisten?.() }
  }, [backend, turnBusy, attachmentBusy])

  async function removeAttachment(index: number) {
    const attachment = attachments[index]
    if (!attachment || attachmentBusy) return
    setAttachmentBusy(true)
    try {
      if (attachment.kind === 'image' && attachment.path) {
        await invoke('detach_chat_image', { sessionId: sessionRef.current, path: attachment.path })
      }
      setAttachments(current => current.filter((_, position) => position !== index))
    } catch (cause) { setChatStatus(t("ui.failed.to.remove.attachment.arg", String(cause))) }
    finally { setAttachmentBusy(false) }
  }

  async function clearPendingImages() {
    for (const attachment of attachments) {
      if (attachment.kind === 'image' && attachment.path) {
        await invoke('detach_chat_image', { sessionId: sessionRef.current, path: attachment.path })
      }
    }
    setAttachments([])
  }

  async function sendMessage() {
    const refs = attachments.filter(item => item.kind === 'file' && item.ref_text).map(item => item.ref_text)
    const typed = draft.trim()
    let text = [typed, ...refs].filter(Boolean).join('\n') || (attachments.length ? t("ui.please.see.attachment") : '')
    if (!text || turnBusy || attachmentBusy) return
    const slash = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(typed)
    const mentions = Array.from(typed.matchAll(/(^|\s)@([^\s]+)/g))
    let catalog: CommandCatalog | null = null
    if (slash || mentions.length) {
      try { catalog = await loadCommandCatalog() }
      catch { if (slash) return }
    }
    const skillMention = mentions.find(match => catalog && Object.hasOwn(catalog.skills, `/${match[2]}`))
    const commandName = slash ? `/${slash[1]}` : skillMention ? `/${skillMention[2]}` : ''
    const isSkill = !!(catalog && Object.hasOwn(catalog.skills, commandName))
    const isCommand = !!(slash || skillMention)
    const commandArg = slash ? slash[2] || '' : skillMention
      ? `${typed.slice(0, skillMention.index)}${typed.slice(skillMention.index! + skillMention[0].length)}`.trim()
      : ''
    // @file:, @folder: and ordinary @mentions remain regular prompt text.
    if (isCommand && (!catalog?.pairs.some(([name]) => name === commandName)
      || !commandSupported(catalog, commandName))) {
      setChatStatus(t("ui.this.command.does.not.exist.for.the.current.session.arg", commandName))
      return
    }
    if (isCommand && attachments.length && !isSkill) { setChatStatus(t("ui.please.remove.the.attachment.first.when.executing.the.command")); return }
    if (isCommand && commandName === '/new' && commandArg) {
      setChatStatus(t("ui.the.desktop.new.command.does.not.accept.a.title.yet.create.a.session.then.u"))
      return
    }
    if (isCommand && commandName === '/sessions' && commandArg) {
      setChatStatus(t("ui.the.desktop.sessions.command.does.not.accept.arguments"))
      return
    }
    if (isCommand && commandName === '/model' && commandArg) {
      setChatStatus(t("ui.choose.a.model.in.model.settings.arguments.after.model.do.not.change.the.cu"))
      return
    }
    assistantRef.current = ''
    setAssistant('')
    setTurnBusy(true)
    setChatStatus(t("ui.submitting"))
    try {
      if (commandName === '/new' && isCommand) {
        await newChat()
        setTurnBusy(false)
        return
      }
      if (commandName === '/sessions' && isCommand) {
        await loadSessions(true)
        openView('chat')
        setSidebarOpen(true)
        setDraft('')
        setTurnBusy(false)
        return
      }
      if (commandName === '/model' && isCommand) {
        openView('model')
        setDraft('')
        setTurnBusy(false)
        return
      }
      const id = await ensureChatSession()
      if (isCommand) {
        const result = isSkill
          ? await invoke<CommandResult>('dispatch_composer_skill', {
            sessionId: id, name: commandName.slice(1), arg: commandArg,
          })
          : await invoke<CommandResult>('execute_composer_command', {
            sessionId: id,
            command: `${commandName}${commandArg ? ` ${commandArg}` : ''}`,
          })
        if (result.type === 'skill' || result.type === 'send') {
          if (!result.message) throw new Error(t("ui.the.command.did.not.return.a.message.to.send"))
          text = [result.message, ...refs].filter(Boolean).join('\n')
        } else if (result.type === 'prefill') {
          setDraft(result.message || '')
          setChatStatus(result.notice || t("ui.the.command.has.been.filled.in.the.input.box"))
          setTurnBusy(false)
          return
        } else if (result.type === 'exec' || result.type === 'plugin' || !result.type) {
          setConversation(rows => [...rows, { role: 'user', text: typed }, { role: 'assistant', text: result.output || result.notice || t("ui.command.execution.completed") }])
          setDraft('')
          setChatStatus(t("ui.command.execution.completed"))
          setTurnBusy(false)
          return
        } else {
          throw new Error(t("ui.this.command.return.type.is.not.supported.yet.arg", result.type))
        }
      }
      setConversation(rows => [...rows, { role: 'user', text: typed || text }])
      setDraft('')
      const result = await invoke<{ status?: string }>('submit_chat_prompt', { sessionId: id, text })
      setAttachments([])
      setChatStatus(previous => previous === t("ui.response.complete") ? previous : t("ui.received.arg", result.status || t('ui.waiting.for.events')))
    } catch (cause) {
      setChatStatus(t("ui.submission.failed.arg.please.check.the.history.first.to.avoid.repeated.subm", String(cause)))
      setTurnBusy(false)
    }
  }

  async function loadSessions(quiet = false) {
    try {
      const result = await invoke<{ sessions: SessionRow[] }>('list_chat_sessions')
      setSessions(result.sessions)
      if (!quiet) setChatStatus(t("ui.arg.historical.conversations.found", result.sessions.length))
    } catch (cause) { setChatStatus(t("ui.failed.to.read.history.arg", String(cause))) }
  }

  async function loadModelOptions(preserveSelection = false) {
    setModelBusy(true)
    setModelOptionsError('')
    setModelStatus(preserveSelection ? t("ui.refreshing.backend.model.directory") : t("ui.loading.model.options"))
    try {
      const [result, configured, config, endpoints] = await Promise.all([
        invoke<ModelOptions>('list_model_options', { refresh: preserveSelection }),
        invoke<ModelOptions>('list_model_options', { refresh: false, includeUnconfigured: false }),
        invoke<SavedModelConfig>('get_saved_model_config'),
        invoke<CustomEndpoints>('list_custom_endpoints'),
      ])
      setCustomEndpoints(endpoints.endpoints || [])
      const availableProviders = (result.providers || []).filter(provider => desktopModelProviderSupported(provider.slug))
      setModelProviders(availableProviders)
      setConfiguredProviders((configured.providers || []).filter(provider => desktopModelProviderSupported(provider.slug) && provider.authenticated !== false))
      const saved = savedModelFromOptions(result, config)
      setSavedModel(saved)
      setModelOptionsLoaded(true)
      if (!preserveSelection) {
        const preset = saved?.provider === 'custom'
          ? VOLCENGINE_PRESETS.find(item => item.baseUrl.replace(/\/$/, '').toLowerCase() === saved.baseUrl.replace(/\/$/, '').toLowerCase())
          : undefined
        const savedProviderSupported = saved && desktopModelProviderSupported(saved.provider)
        setModelProvider(preset?.id || (savedProviderSupported ? saved.provider : '') || availableProviders[0]?.slug || 'custom')
        setModelName(savedProviderSupported ? saved.model : '')
        setModelBaseUrl(saved?.provider === 'custom' ? saved.baseUrl : '')
      }
      if (preserveSelection) {
        const count = result.providers?.find(provider => provider.slug === modelProvider)?.models?.length || 0
        setModelStatus(selectedPreset
          ? t("ui.the.backend.directory.has.been.refreshed.volcano.ark.s.built.in.reference.c")
          : t("ui.backend.catalog.refreshed.current.provider.returned.arg.models.arg", count, count ? '' : t('ui.built.in.examples.or.manual.entry.remain.available')))
      } else {
        setModelStatus('')
      }
    } catch (cause) {
      setModelOptionsError(String(cause))
      setModelStatus(t("ui.failed.to.load.model.options.arg", String(cause)))
    }
    finally { setModelBusy(false) }
  }

  function selectModelProvider(provider: string, model = '', fresh = false) {
    const preset = VOLCENGINE_PRESETS.find(row => row.id === provider)
    setModelProvider(provider)
    setModelName(model)
    setModelBaseUrl(preset?.baseUrl || (!fresh && savedModel?.provider === provider ? savedModel.baseUrl : ''))
    setModelConfirmation('')
    setModelFormOpen(true)
  }

  async function persistModelLists(next: Record<string, string[]>) {
    await invoke('save_model_lists', { storagePath, lists: next })
    setModelLists(next)
    try { localStorage.setItem(`${MODEL_LISTS_KEY}:${storagePath}`, JSON.stringify(next)) } catch { /* Native storage is authoritative. */ }
  }

  async function saveProviderModels(provider: string, models: string[]): Promise<boolean> {
    if (modelListLoading || modelListBusy) return false
    if (models.some(model => !model.trim() || model.length > 256 || /\s/.test(model))) {
      setModelStatus(t('ui.invalid.model.id'))
      return false
    }
    if (new Set(models).size !== models.length) {
      setModelStatus(t('ui.duplicate.model.id'))
      return false
    }
    const next = { ...modelLists, [provider]: models }
    setModelListBusy(true)
    try {
      await persistModelLists(next)
      setModelStatus(t('ui.provider.models.saved.locally'))
      return true
    } catch (cause) {
      setModelStatus(t('ui.failed.to.save.provider.models.arg', String(cause)))
      return false
    } finally { setModelListBusy(false) }
  }

  async function renameProviderModel(provider: string, models: string[], original: string) {
    const replacement = editingModel?.value.trim() || ''
    if (await saveProviderModels(provider, models.map(model => model === original ? replacement : model))) setEditingModel(null)
  }

  async function addProviderModel(provider: string, models: string[]) {
    const nextModel = newModelId.trim()
    if (await saveProviderModels(provider, [...models, nextModel])) {
      setAddingModelProvider('')
      setNewModelId('')
    }
  }

  async function addProvider() {
    if (!newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()) return
    if (customEndpoints.some(endpoint => normalizedEndpoint(endpoint.base_url) === normalizedEndpoint(newProviderUrl))) {
      setProviderFormError(t('ui.provider.endpoint.already.exists'))
      return
    }
    setModelBusy(true)
    try {
      await invoke('add_custom_endpoint', { name: newProviderName.trim(), baseUrl: newProviderUrl.trim(), model: newProviderModel.trim(), apiKey: newProviderKey })
      setAddingProvider(false)
      setNewProviderPreset('')
      setProviderFormError('')
      setNewProviderName('')
      setNewProviderUrl('')
      setNewProviderModel('')
      setModelSuggestionsOpen(false)
      setModelSuggestionQuery('')
      setNewProviderKey('')
      await loadModelOptions(true)
      setModelStatus(t('ui.provider.added'))
    } catch (cause) { setProviderFormError(t('ui.provider.add.failed.arg', String(cause))) }
    finally { setModelBusy(false) }
  }

  function chooseProviderPreset(value: string) {
    setNewProviderPreset(value)
    setProviderFormError('')
    setModelSuggestionsOpen(false)
    setModelSuggestionQuery('')
    if (!value) {
      setNewProviderName('')
      setNewProviderUrl('')
      setNewProviderModel('')
      return
    }
    const preset = VOLCENGINE_PRESETS.find(item => `preset:${item.id}` === value)
    const provider = modelProviders.find(item => item.slug === value)
    setNewProviderName(preset ? t(preset.name) : provider?.name || '')
    setNewProviderUrl(preset?.baseUrl || provider?.api_url || '')
    setNewProviderModel(preset?.models[0] || provider?.models[0] || MODEL_FALLBACKS[value]?.[0] || '')
  }

  async function deleteProvider(endpoint: CustomEndpoint) {
    if (endpoint.source === 'direct-config' || (endpoint.is_current && savedModel?.provider === 'custom')) {
      setModelStatus(t('ui.switch.default.before.deleting.provider'))
      return
    }
    if (!window.confirm(t('ui.delete.provider.confirm.arg', endpoint.name))) return
    setModelBusy(true)
    try {
      await invoke('delete_custom_endpoint', { endpointId: endpoint.id })
      if (modelProvider === endpoint.id) setModelFormOpen(false)
      await loadModelOptions(false)
      setModelStatus(t('ui.provider.deleted'))
    } catch (cause) { setModelStatus(t('ui.provider.delete.failed.arg', String(cause))) }
    finally { setModelBusy(false) }
  }

  async function saveModel(confirm = false) {
    if (!modelProvider.trim() || !modelName.trim()) return
    setModelBusy(true)
    setModelStatus(t("ui.saving.model.configuration"))
    try {
      const result = await invoke<ModelAssignment>('set_default_model', {
        provider: selectedPreset ? 'custom' : modelProvider.trim(), model: modelName.trim(),
        baseUrl: modelBaseUrl.trim(), apiKey: modelKey,
        confirmExpensiveModel: confirm,
      })
      if (result.confirm_required) {
        setModelConfirmation(result.confirm_message || t("ui.this.model.needs.confirmation"))
        setModelStatus(t("ui.please.confirm.model.selection"))
      } else if (result.ok) {
        setModelConfirmation('')
        setModelKey('')
        setSavedModel({
          provider: result.provider || (selectedPreset ? 'custom' : modelProvider),
          model: result.model || modelName,
          name: selectedPreset?.name || modelProviders.find(provider => provider.slug === modelProvider)?.name || modelProvider,
          baseUrl: modelBaseUrl.trim(),
        })
        setModelOptionsLoaded(true)
        setModelStatus(t("ui.saved.arg.arg.applies.to.new.sessions", selectedPreset ? t(selectedPreset.name) : result.provider || modelProvider, result.model || modelName))
      } else {
        setModelStatus(t("ui.model.configuration.not.accepted.by.backend"))
      }
    } catch (cause) { setModelStatus(t("ui.failed.to.save.model.arg", String(cause))) }
    finally { setModelBusy(false) }
  }

  async function checkModel() {
    setModelBusy(true)
    try {
      const result = await invoke<{ ok?: boolean; provider?: string; model?: string; error?: string }>('check_model_runtime')
      setModelStatus(result.ok ? t("ui.runtime.recognized.arg.arg", result.provider || '', result.model || '')
        : t("ui.runtime.not.ready.arg", result.error || t("ui.check.the.key.and.model.settings")))
    } catch (cause) { setModelStatus(t("ui.check.model.failed.arg", String(cause))) }
    finally { setModelBusy(false) }
  }

  async function openModelPicker(refresh = true) {
    if (!backend) return
    setModelPickerOpen(true)
    setPickerBusy(true)
    setPickerError('')
    try {
      const result = await invoke<ModelOptions>('list_model_options', {
        refresh, includeUnconfigured: false, sessionId: sessionRef.current || undefined,
      })
      const providers = (result.providers || []).filter(row => desktopModelProviderSupported(row.slug) && row.authenticated !== false)
      setPickerProviders(providers)
      setActiveModel(result.model && result.provider ? { provider: result.provider, model: result.model } : null)
      setPickerProvider(current => providers.some(row => row.slug === current) ? current
        : providers.find(row => row.slug === result.provider)?.slug || providers[0]?.slug || '')
    } catch (cause) { setPickerError(String(cause)) }
    finally { setPickerBusy(false) }
  }

  async function pickModel(provider: string, model: string, remember = false, confirm?: string) {
    if (!provider || !model.trim() || pickerBusy || turnBusy) return
    setPickerBusy(true)
    setPickerError('')
    try {
      const id = await ensureChatSession()
      const result = await invoke<ModelPickResult>('select_chat_model', { sessionId: id, provider, model: model.trim(), confirm })
      if (result.confirm_required && result.confirm) {
        setPickerConfirmation({ provider, model: model.trim(), remember, token: result.confirm, message: result.confirm_message || t('ui.please.confirm.model.selection') })
        return
      }
      if (!result.model || result.status === 'refused') throw new Error(t('ui.model.switch.not.applied'))
      setActiveModel({ provider: result.provider || provider, model: result.model })
      setPickerConfirmation(null)
      let remembered = true
      if (remember) {
        const pickerRow = pickerProviders.find(row => row.slug === provider)
        const endpoint = customEndpoints.find(item => item.id === provider || (pickerRow?.api_url && normalizedEndpoint(item.base_url) === normalizedEndpoint(pickerRow.api_url)))
        const modelListKey = endpoint?.id || provider
        const savedList = savedCandidates(provider, pickerProviders)
        if (savedList) {
          const next = { ...modelLists, [modelListKey]: [...new Set([...savedList, model.trim()])] }
          try { await persistModelLists(next) }
          catch { remembered = false }
        } else {
          const next = { ...addedModels, [provider]: [...new Set([...(addedModels[provider] || []), model.trim()])] }
          try { localStorage.setItem(`${ADDED_MODELS_KEY}:${storagePath}`, JSON.stringify(next)); setAddedModels(next) }
          catch { remembered = false }
        }
        setPickerModelInput('')
      }
      setChatStatus(remembered ? t('ui.model.switched.for.session.arg', result.model) : t('ui.failed.to.save.model.id'))
      setModelPickerOpen(false)
    } catch (cause) { setPickerError(String(cause)) }
    finally { setPickerBusy(false) }
  }

  async function newChat() {
    if (turnBusy || attachmentBusy) return
    try { await clearPendingImages() }
    catch (cause) { setChatStatus(t("ui.failed.to.remove.image.before.creating.new.session.arg", String(cause))); return }
    sessionRef.current = ''
    storedSessionRef.current = ''
    setSessionId('')
    setActiveModel(null)
    setModelPickerOpen(false)
    setConversation([])
    assistantRef.current = ''
    setAssistant('')
    setServerRequests([])
    setDraft('')
    setCommandCatalog(null)
    commandCatalogPromiseRef.current = null
    setChatStatus(t("ui.new.session.ready"))
  }

  async function resumeSession(id: string) {
    if (turnBusy || attachmentBusy) return
    setChatStatus(t("ui.resuming.session"))
    try {
      await clearPendingImages()
      const result = await invoke<ResumeResult>('resume_chat_session', { sessionId: id })
      sessionRef.current = result.session_id
      storedSessionRef.current = result.stored_session_id || result.session_key || id
      epochRef.current[result.session_id] = backend?.replay_epoch || ''
      lastSeqRef.current[result.session_id] = result.last_sequence || 0
      setServerRequests((result.open_requests || []).filter(request => request.method === 'approval' || request.method === 'clarify'))
      setClarifyAnswers({})
      setSessionId(result.session_id)
      setActiveModel(result.info?.provider && result.info.model ? { provider: result.info.provider, model: result.info.model } : null)
      setModelPickerOpen(false)
      setDraft('')
      setCommandCatalog(null)
      commandCatalogPromiseRef.current = null
      setConversation(result.messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => ({ role: message.role, text: message.text || '' })))
      assistantRef.current = result.inflight?.assistant || ''
      setAssistant(assistantRef.current)
      setTurnBusy(Boolean(result.running))
      setChatStatus(result.running ? t("ui.restored.task.still.running") : t("ui.session.resumed"))
    } catch (cause) { setChatStatus(t("ui.restore.failed.arg", String(cause))) }
  }

  async function interruptSession() {
    if (!sessionRef.current) return
    try {
      const result = await invoke<{ status: string }>('interrupt_chat_session', { sessionId: sessionRef.current })
      setChatStatus(result.status === 'interrupted' ? t("ui.requested.to.stop.current.task") : t("ui.there.are.currently.no.tasks.running"))
      setTurnBusy(false)
    } catch (cause) { setChatStatus(t("ui.failed.to.stop.task.arg", String(cause))) }
  }

  async function reconnectBackend() {
    if (recoveringRef.current) return
    recoveringRef.current = true
    bufferedEventsRef.current = []
    bufferedRequestsRef.current = []
    const previousId = sessionRef.current
    const previousEpoch = epochRef.current[previousId]
    const previousSeq = lastSeqRef.current[previousId] || 0
    setBusy(true)
    setBackendStatus(t("ui.reconnecting"))
    try {
      const info = await runtime.reconnect()
      setBackend(info)
      setBackendStatus(previousEpoch && info.replay_epoch !== previousEpoch
        ? t("ui.reconnected.pictures.to.be.sent.need.to.be.added.again") : t("ui.reconnected"))
      if (previousEpoch && info.replay_epoch !== previousEpoch) {
        setAttachments(current => current.filter(item => item.kind === 'file'))
      }
      if (storedSessionRef.current) {
        const snapshot = await invoke<ResumeResult>('resume_chat_session', { sessionId: storedSessionRef.current })
        const id = snapshot.session_id
        const sameStream = id === previousId && Boolean(previousEpoch) && info.replay_epoch === previousEpoch
        let replay: ReplayResult | undefined
        if (sameStream) {
          replay = await invoke<ReplayResult>('replay_chat_events', {
            sessionId: id, lastSeen: previousSeq, replayEpoch: previousEpoch,
          })
        }
        const useSnapshot = !sameStream || !replay || replay.truncated || replay.epoch !== previousEpoch
        sessionRef.current = id
        storedSessionRef.current = snapshot.stored_session_id || snapshot.session_key || storedSessionRef.current
        setSessionId(id)
        setActiveModel(snapshot.info?.provider && snapshot.info.model ? { provider: snapshot.info.provider, model: snapshot.info.model } : null)
        setClarifyAnswers({})
        setServerRequests((replay?.open_requests || snapshot.open_requests || []).filter(request => request.method === 'approval' || request.method === 'clarify'))
        setTurnBusy(Boolean(snapshot.running))
        if (useSnapshot) {
          setConversation(snapshot.messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => ({ role: message.role, text: message.text || '' })))
          assistantRef.current = snapshot.inflight?.assistant || ''
          setAssistant(assistantRef.current)
          epochRef.current[id] = info.replay_epoch
          lastSeqRef.current[id] = snapshot.last_sequence || 0
        } else if (replay) {
          const ordered = replay.events.map(event => ({
            kind: event.type, session_id: event.session_id, seq: event.seq,
            payload: event.payload || {},
          })).sort((a, b) => (a.seq || 0) - (b.seq || 0))
          for (const event of ordered) eventProcessorRef.current(event)
        }
        const buffered = bufferedEventsRef.current.splice(0)
          .sort((a, b) => (a.seq || 0) - (b.seq || 0))
        for (const event of buffered) eventProcessorRef.current(event)
        for (const request of bufferedRequestsRef.current.splice(0)) {
          if (request.params.session_id === id) {
            setServerRequests(current => current.some(item => item.id === request.id) ? current : [...current, request])
          }
        }
        if (useSnapshot) setChatStatus(replay?.truncated ? t("ui.event.window.truncated.restored.from.session.snapshot") : t("ui.restored.from.session.snapshot"))
        else if (replay?.events.length === 0) setChatStatus(snapshot.running ? t("ui.restored.task.still.running") : t("ui.session.resumed"))
      }
    } catch (cause) {
      void diagnostics.recordEvent(storagePath, 'reconnect_failed').catch(() => {})
      setBackendStatus(t("ui.reconnection.failed.arg", String(cause)))
    }
    finally {
      recoveringRef.current = false
      for (const event of bufferedEventsRef.current.splice(0)) eventProcessorRef.current(event)
      bufferedRequestsRef.current = []
      setBusy(false)
    }
  }

  async function startBackend(selectedStoragePath = storagePath, selectedPythonPath = pythonPath) {
    setBusy(true)
    setBackendStatus(t("ui.starting.and.authenticating"))
    try {
      const info = import.meta.env.DEV
        ? await runtime.startDev(selectedStoragePath, selectedPythonPath)
        : await runtime.startPacked(selectedStoragePath)
      setBackend(info)
      setBackendStatus(t("ui.ready.websocket.ping.succeeded"))
      if (!import.meta.env.DEV) setStorageLocked(true)
      setModelOptionsLoaded(false)
      setModelOptionsError('')
      setSavedModel(null)
      void loadModelOptions()
      void loadSessions(true)
    } catch (cause) {
      void diagnostics.recordEvent(selectedStoragePath, 'startup_failed').catch(() => {})
      setBackend(null)
      setActiveModel(null)
      setModelPickerOpen(false)
      sessionRef.current = ''
      storedSessionRef.current = ''
      setSessionId('')
      setConversation([])
      assistantRef.current = ''
      setAssistant('')
      setServerRequests([])
      setSessions([])
      setSavedModel(null)
      setModelOptionsLoaded(false)
      setModelOptionsError('')
      setAttachments([])
      setBackendStatus(t("ui.startup.failed.arg", String(cause)))
    } finally { setBusy(false) }
  }

  async function chooseStoragePath() {
    try {
      const selected = await open({ directory: true, multiple: false, title: t("ui.choose.primary.storage.location") })
      if (typeof selected === 'string') setStoragePath(selected)
    } catch (cause) { setBackendStatus(t("ui.failed.to.select.directory.arg", String(cause))) }
  }

  async function pingBackend() {
    setBusy(true)
    try {
      await runtime.ping()
      setBackendStatus(t("ui.connection.healthy.websocket.ping.succeeded"))
    } catch (cause) {
      void diagnostics.recordEvent(storagePath, 'connection_failed').catch(() => {})
      setBackendStatus(t("ui.connection.failed.arg", String(cause)))
    }
    finally { setBusy(false) }
  }

  async function stopBackend() {
    setBusy(true)
    try {
      await runtime.stop()
      setBackend(null)
      setActiveModel(null)
      setModelPickerOpen(false)
      sessionRef.current = ''
      storedSessionRef.current = ''
      setSessionId('')
      setConversation([])
      assistantRef.current = ''
      setAssistant('')
      setServerRequests([])
      setSessions([])
      setSavedModel(null)
      setModelOptionsLoaded(false)
      setModelOptionsError('')
      setAttachments([])
      setBackendStatus(t("ui.stopped"))
    } catch (cause) {
      void diagnostics.recordEvent(storagePath, 'stop_failed').catch(() => {})
      setBackendStatus(t("ui.stop.failed.arg", String(cause)))
    }
    finally { setBusy(false) }
  }

  const openView = (next: View) => {
    if (view === 'agent' && next !== 'agent' && agentConfigDirty && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return
    if (next !== 'agent') setAgentConfigDirty(false)
    setView(next)
    setSidebarOpen(false)
  }
  const activeSession = sessions.find(session => session.id === storedSessionRef.current)
  return <div className="app-shell">
    <Sidebar view={view} open={sidebarOpen} connected={Boolean(backend)} busy={turnBusy || attachmentBusy} sessions={sessions} activeSessionId={storedSessionRef.current} onClose={() => setSidebarOpen(false)} onOpenView={openView} onNewChat={() => { void newChat(); openView('chat') }} onRefreshSessions={() => void loadSessions(true)} onResumeSession={id => { openView('chat'); void resumeSession(id) }} />
    <main className="workspace">
      <WorkspaceHeader view={view} sessionTitle={activeSession?.title} connected={Boolean(backend)} onOpenNavigation={() => setSidebarOpen(true)} />
    {view === 'tools' && <ToolsView connected={Boolean(backend)} sessionId={sessionId} />}
    {view === 'agent' && <AgentSettingsView connected={Boolean(backend)} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => openView('model')} />}
    {view === 'runtime' && <RuntimeView storagePath={storagePath} onStoragePathChange={setStoragePath} storageLocked={storageLocked} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} onChooseStoragePath={chooseStoragePath} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onStop={stopBackend} />}
    {view === 'model' && <section className="settings-panel model-settings-panel">
      {!backend ? <div className="empty-panel"><h2>{t("ui.start.the.runtime.first")}</h2><p>{t("ui.model.settings.require.a.connection.to.the.local.hermes.runtime")}</p><button onClick={() => openView('runtime')}>{t("ui.go.to.runtime.storage")}</button></div> : <>
      <div className="row model-page-heading"><h2>{t('ui.model.providers')}</h2><div className="model-page-actions"><button disabled={modelBusy} onClick={() => void loadModelOptions(true)}>{t("ui.reload.settings.and.options")}</button><button type="button" onClick={() => { setProviderFormError(''); setAddingProvider(true) }}>{t('ui.add.provider')}</button></div></div>
      {addingProvider && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !modelBusy) setAddingProvider(false) }}><div className="provider-add-form" role="dialog" aria-modal="true" aria-labelledby="provider-add-title">
        <h3 id="provider-add-title">{t('ui.add.custom.provider')}</h3>
        <label>{t('ui.provider.preset')}<select autoFocus value={newProviderPreset} onChange={event => chooseProviderPreset(event.target.value)}>
          <option value="">{t('ui.custom.provider.template')}</option>
          {VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{t(preset.name)}</option>)}
          {modelProviders.filter(provider => provider.slug !== 'custom' && !provider.slug.startsWith('custom:') && !provider.is_user_defined && !VOLCENGINE_PRESETS.some(preset => preset.id === provider.slug)).map(provider => <option key={provider.slug} value={provider.slug}>{provider.name}</option>)}
        </select></label>
        <small>{t('ui.provider.preset.hint')}</small>
        <label>{t('ui.provider.name')}<input value={newProviderName} onChange={event => setNewProviderName(event.target.value)} /></label>
        <label>{t('ui.provider.endpoint')}<input type="url" value={newProviderUrl} onChange={event => setNewProviderUrl(event.target.value)} placeholder="https://example.com/v1" /></label>
        <label>{t('ui.provider.default.model')}<div className="provider-model-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setModelSuggestionsOpen(false) }}>
          <input role="combobox" aria-autocomplete="list" aria-expanded={modelSuggestionsOpen && visibleProviderModels.length > 0} aria-controls="provider-preset-models" value={newProviderModel} onFocus={() => { setModelSuggestionQuery(''); setModelSuggestionsOpen(true) }} onChange={event => { setNewProviderModel(event.target.value); setModelSuggestionQuery(event.target.value); setModelSuggestionsOpen(true) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setModelSuggestionsOpen(false) } }} />
          {newProviderPresetModels.length > 0 && <button type="button" className="provider-model-toggle" aria-label={t('ui.model.options')} aria-expanded={modelSuggestionsOpen} onClick={() => { setModelSuggestionQuery(''); setModelSuggestionsOpen(value => !value) }}>▾</button>}
          {modelSuggestionsOpen && visibleProviderModels.length > 0 && <div id="provider-preset-models" className="provider-model-suggestions" role="listbox" aria-label={t('ui.model.options')}>
            {visibleProviderModels.map(model => <button type="button" role="option" aria-selected={newProviderModel === model} key={model} onClick={() => { setNewProviderModel(model); setModelSuggestionQuery(''); setModelSuggestionsOpen(false) }}>{model}</button>)}
          </div>}
        </div></label>
        <label>{t('ui.provider.api.key.optional')}<input type="password" autoComplete="off" value={newProviderKey} onChange={event => setNewProviderKey(event.target.value)} /></label>
        {providerFormError && <p role="alert">{providerFormError}</p>}
        <div className="actions"><button disabled={modelBusy || !newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()} onClick={() => void addProvider()}>{t('ui.save.provider')}</button><button type="button" disabled={modelBusy} onClick={() => setAddingProvider(false)}>{t('ui.cancel')}</button></div>
      </div></div>}
      {!modelOptionsLoaded && (modelOptionsError
        ? <p role="alert">{t("ui.failed.to.load.saved.settings")}{modelOptionsError}</p>
        : <p role="status">{t("ui.loading.runtime.model.settings")}</p>)}
      {modelOptionsLoaded && <div className="provider-section">
        <p>{t('ui.provider.model.list.local.note')}</p>
        {providerCards.length === 0 && <p>{t('ui.no.configured.providers')}</p>}
        <div className="provider-grid">{providerCards.map(provider => {
          const endpoint = customEndpoints.find(item => item.id === provider.slug)
            || ((provider.is_user_defined || provider.slug === 'custom' || provider.slug.startsWith('custom:'))
              ? customEndpoints.find(item => Boolean(provider.api_url) && item.base_url.replace(/\/$/, '') === provider.api_url.replace(/\/$/, ''))
              : undefined)
          const modelListKey = endpoint?.id || provider.slug
          const legacyModelListKey = endpoint ? `custom:${endpoint.name.toLowerCase().replace(/\s+/g, '-')}` : provider.slug
          const models = modelLists[modelListKey] ?? modelLists[provider.slug] ?? modelLists[legacyModelListKey]
            ?? [...new Set([...provider.models, ...(addedModels[provider.slug] || [])])]
          const isDefault = Boolean(savedModel && (savedModel.provider === provider.slug || (savedModel.baseUrl && provider.api_url && normalizedEndpoint(savedModel.baseUrl) === normalizedEndpoint(provider.api_url))))
          const providerPreset = VOLCENGINE_PRESETS.find(preset => normalizedEndpoint(preset.baseUrl) === normalizedEndpoint(endpoint?.base_url || provider.api_url))
          return <div className={`provider-card ${isDefault ? 'selected' : ''}`} key={provider.slug}>
            {isDefault && <span className="saved-badge">{t('ui.current.default')}</span>}
            <div className="provider-card-heading"><strong>{providerPreset ? t(providerPreset.name) : endpoint?.name || provider.name}</strong><small>{models.length} {t('ui.models.count.unit')}</small></div>
            {endpoint && <div className="provider-card-meta"><small>{providerPreset ? t('ui.preset.endpoint.via.custom') : t('ui.custom.endpoint')}：{endpoint.base_url}</small><button type="button" disabled={modelBusy} onClick={() => void deleteProvider(endpoint)}>{t('ui.delete.provider')}</button></div>}
            {isDefault && savedModel?.baseUrl && <small className="provider-card-endpoint">{savedModel.baseUrl}</small>}
            <div className="provider-model-list"><div className="provider-model-items" role="region" aria-label={`${provider.name} ${t('ui.model.options')}`} tabIndex={0}>{models.map(model => {
              const editing = editingModel?.provider === provider.slug && editingModel.original === model
              return <div className="provider-model-row" key={model}>
                {editing ? <><input aria-label={t('ui.model.id')} value={editingModel.value} onChange={event => setEditingModel({ provider: provider.slug, original: model, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void renameProviderModel(modelListKey, models, model); if (event.key === 'Escape') setEditingModel(null) }} />
                  <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void renameProviderModel(modelListKey, models, model)}>{t('ui.save')}</button><button type="button" onClick={() => setEditingModel(null)}>{t('ui.cancel')}</button></>
                  : <><button type="button" className={`provider-model-id ${isDefault && savedModel?.model === model ? 'current' : ''}`} title={t('ui.select.as.default.model')} onClick={() => selectModelProvider(provider.slug, model)}>{model}</button>
                    <button type="button" onClick={() => setEditingModel({ provider: provider.slug, original: model, value: model })}>{t('ui.edit')}</button></>}
                <button type="button" disabled={modelListBusy || modelListLoading} className="provider-model-delete" aria-label={t('ui.delete.model.arg', model)} onClick={() => { void saveProviderModels(modelListKey, models.filter(item => item !== model)).then(saved => { if (saved && editing) setEditingModel(null) }) }}>{t('ui.remove')}</button>
              </div>
            })}</div>
              {addingModelProvider === provider.slug ? <div className="provider-model-row provider-model-add-row"><input autoFocus aria-label={t('ui.new.model.id')} value={newModelId} onChange={event => { setNewModelId(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void addProviderModel(modelListKey, models); if (event.key === 'Escape') { setAddingModelProvider(''); setNewModelId('') } }} placeholder={t('ui.model.id')} />
                <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void addProviderModel(modelListKey, models)}>{t('ui.save')}</button><button type="button" onClick={() => { setAddingModelProvider(''); setNewModelId('') }}>{t('ui.cancel')}</button></div>
                : <button type="button" className="provider-add-model" onClick={() => { setAddingModelProvider(provider.slug); setNewModelId('') }}>{t('ui.add.model')}</button>}
            </div>
          </div>
        })}</div>
      </div>}
      {modelFormOpen && <><div className="row model-editor-heading"><h2>{t("ui.select.or.modify.a.model")}</h2><button type="button" onClick={() => { setModelFormOpen(false); setModelConfirmation('') }}>{t('ui.cancel')}</button></div>
      <label>{t("ui.provider")}<select value={modelProvider} onChange={event => {
        selectModelProvider(event.target.value)
      }}>
        {!selectedPreset && !modelProviders.some(provider => provider.slug === modelProvider) && modelProvider !== 'custom' && <option value={modelProvider}>{modelProvider || t("ui.select")}</option>}
        {!modelProviders.some(provider => provider.slug === 'custom') && <option value="custom">{t("ui.custom.openai.compatible.endpoint.custom")}</option>}
        {VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{t(preset.name)}</option>)}
        {modelProviders.map(provider => <option key={provider.slug} value={provider.slug}>{provider.name}（{provider.slug}）</option>)}
      </select></label>
      {modelLists[modelProvider] === undefined && fallbackCandidates.length > 0 && backendCandidates.length === 0 && <small>{t("ui.displays.built.in.reference.candidates.the.actual.available.models.are.subj")}</small>}
      {modelCandidates.length > 0 && <label>{t("ui.model.options")}<select value={modelCandidates.some(model => model === modelName) ? modelName : ''} onChange={event => { setModelName(event.target.value); setModelConfirmation('') }}>
        <option value="">{t("ui.select.model")}</option>
        {modelCandidates.map(model => <option key={model} value={model}>{model}</option>)}
      </select></label>}
      {modelCandidates.length === 0 && <small>{t("ui.this.provider.currently.has.no.model.candidates.please.fill.in.the.model.id")}</small>}
      <label>{t("ui.model.id.or.enter.one.manually")}<input value={modelName} onChange={event => { setModelName(event.target.value); setModelConfirmation('') }} /></label>
      <label>{t("ui.api.endpoint.for.a.custom.endpoint")}<input value={modelBaseUrl} onChange={event => { setModelBaseUrl(event.target.value); setModelConfirmation('') }} placeholder="https://example.com/v1" /></label>
      <label>{t("ui.api.key.if.you.already.have.a.key.you.can.leave.it.blank")}<input type="password" autoComplete="off" value={modelKey} onChange={event => { setModelKey(event.target.value); setModelConfirmation('') }} /></label>
      <div className="actions"><button disabled={modelBusy || !modelProvider.trim() || !modelName.trim()} onClick={() => void saveModel()}>{t("ui.save.default.model")}</button><button disabled={modelBusy} onClick={() => void checkModel()}>{t("ui.check.runtime")}</button></div>
      {modelConfirmation && <div role="alert"><p>{modelConfirmation}</p><button disabled={modelBusy} onClick={() => void saveModel(true)}>{t("ui.confirm.this.model")}</button></div>}
      </>}
      {modelStatus && <p role="status">{localizeAppMessage(language, modelStatus)}</p>}
      </>}
    </section>}
    {view === 'chat' && <section className={`chat-panel ${draggingFiles ? 'drop-active' : ''} ${conversation.length === 0 && !assistant ? 'chat-empty' : ''}`}>
      {!backend ? <div className="chat-gate"><span className="hero-mark">H</span><h2>{t("ui.ready.to.chat")}</h2><p>{t("ui.after.starting.the.native.runtime.and.configuring.the.model.you.can.create")}</p><button onClick={() => openView('runtime')}>{t("ui.start.the.runtime")}</button><small>{localizeAppMessage(language, backendStatus)}</small></div> : <>
      <div className="chat-content">
      {conversation.length === 0 && !assistant && <div className="welcome"><span className="hero-mark">H</span><h2>{t("ui.hello.what.do.you.want.to.do.today")}</h2><p>{t("ui.describe.a.task.to.hermess.or.add.files.to.work.on.together")}</p></div>}
      {(conversation.length > 0 || assistant) && <div className="messages">{conversation.map((message, index) =>
        <p key={index}><strong>{message.role === 'user' ? t("ui.you") : 'Hermes'}：</strong>{message.text}</p>
      )}{assistant && <p><strong>Hermes：</strong>{assistant}</p>}</div>}
      {serverRequest?.method === 'approval' && <div className="request-card" role="alertdialog" aria-label={t("ui.tool.execution.approval")}>
        <strong>{t("ui.tool.execution.approval")}</strong>
        <p>{serverRequest.params.description || serverRequest.params.tool_name || t("ui.hermes.requests.permission.to.run.a.tool")}</p>
        {serverRequest.params.command && <pre>{serverRequest.params.command}</pre>}
        <div className="actions">{(serverRequest.params.choices || ['deny']).map(choice =>
          <button key={choice} onClick={() => void answerRequest(choice)}>{({ once: t("ui.allow.once"), session: t("ui.allow.for.this.session"), always: t("ui.always.allowed"), deny: t("ui.deny") })[choice]}</button>
        )}</div>
      </div>}
      {serverRequest?.method === 'clarify' && <div className="request-card" role="group" aria-label={t("ui.clarifying.questions")}>
        <strong>{t("ui.hermes.needs.additional.information")}</strong>
        {(serverRequest.params.questions || []).map(question => <label key={question.qid}>{question.question}
          {question.choices?.length ? <select value={clarifyAnswers[question.qid] || ''} onChange={event => setClarifyAnswers(previous => ({ ...previous, [question.qid]: event.target.value }))}>
            <option value="">{t("ui.select")}</option>{question.choices.map(option => <option key={option} value={option}>{option}</option>)}
          </select> : <input value={clarifyAnswers[question.qid] || ''} onChange={event => setClarifyAnswers(previous => ({ ...previous, [question.qid]: event.target.value }))} />}
        </label>)}
        <button onClick={() => void answerRequest()}>{t("ui.submit.answer")}</button>
      </div>}
      </div>
      <div className="composer-wrap"><div className="composer">
       <textarea ref={draftInputRef} value={draft} onChange={event => { setDraft(event.target.value); setDraftCaret(event.target.selectionStart); setActiveChoice(0) }}
         onSelect={event => setDraftCaret(event.currentTarget.selectionStart)}
        onKeyDown={event => {
          if (!choices.length) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveChoice(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length)
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            chooseCommand(choices[activeChoice] || choices[0])
          } else if (event.key === 'Escape') {
            setDraft(value => `${value} `)
          }
        }} placeholder={t("ui.what.do.you.want.to.do.today.enter.to.select.a.command.to.select.a.skill")} rows={3} />
      {trigger && <div className="composer-choices" role="listbox" aria-label={t("ui.commands.and.skills")}>
        {choices.map((choice, index) => <button key={choice.name} type="button" role="option" aria-selected={index === activeChoice}
          aria-disabled={!choice.available} className={`${index === activeChoice ? 'active' : ''} ${choice.available ? '' : 'unavailable'}`}
          onMouseDown={event => event.preventDefault()} onClick={() => chooseCommand(choice)}>
          <strong>{choice.name}</strong><span>{choice.description}</span><small>{choice.skill ? 'Skill · ' : ''}{choice.availability}</small>
        </button>)}
        {!choices.length && <p>{commandCatalogError || (commandCatalog ? t("ui.no.matching.commands.or.skills") : t("ui.loading.commands.and.skills"))}</p>}
      </div>}
      {attachments.length > 0 && <ul>{attachments.map((attachment, index) => <li key={`${attachment.path || attachment.ref_text}-${index}`}>
        <span>{attachment.kind === 'image' ? t("ui.image") : t("ui.file")}：{attachment.name}（{attachment.bytes} {t("ui.bytes")}</span>
        <button disabled={attachmentBusy || turnBusy} onClick={() => void removeAttachment(index)}>{t("ui.remove")}</button>
        <code title={t("ui.source.path")}>{attachment.source_path}</code>
        {attachment.preview && <details><summary>{t("ui.text.preview")}</summary><pre>{attachment.preview}</pre></details>}
      </li>)}</ul>}
      <div className="composer-actions">
        <button className="secondary-button" disabled={turnBusy || attachmentBusy} onClick={() => void chooseAttachments()}>{t("ui.attach")}</button>
        <span className="composer-spacer" />
        <span className="context-indicator" title={chatUsage?.context_source || ''} aria-label={contextLabel(chatUsage, language)}>
          <svg className="context-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="context-ring-track" cx="18" cy="18" r="15" />
            {contextPercent(chatUsage) !== null && <circle className="context-ring-fill" cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${contextPercent(chatUsage)} 100`} />}
          </svg>
          <span>{contextLabel(chatUsage, language)}</span>
        </span>
        <label className="reasoning-picker">
          <select aria-label={language === 'zh-CN' ? '思考强度' : 'Reasoning effort'} value={reasoningEffort} disabled={reasoningBusy || !backend} onChange={event => void changeReasoning(event.target.value)}>
            <option value="">{language === 'zh-CN' ? '思考 · 默认' : 'Reasoning · Default'}</option>
            {['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option value={value} key={value}>{language === 'zh-CN' ? '思考' : 'Reasoning'} · {value}</option>)}
          </select>
        </label>
        <button ref={modelButtonRef} className="secondary-button" disabled={turnBusy} aria-haspopup="dialog" aria-expanded={modelPickerOpen} onClick={() => modelPickerOpen ? setModelPickerOpen(false) : void openModelPicker()}>{activeModel?.model || savedModel?.model || t("ui.select.model")}</button>
        {turnBusy ? <button onClick={() => void interruptSession()}>{t("ui.stop")}</button> : <button disabled={attachmentBusy || (!draft.trim() && attachments.length === 0)} onClick={() => void sendMessage()}>{t("ui.send")}</button>}
      </div>
      {modelPickerOpen && <div ref={modelPickerRef} className="model-picker" role="dialog" aria-label={t('ui.select.model')} style={pickerPosition}>
        <div className="model-picker-header"><strong>{t('ui.select.model')}</strong><span><button type="button" title={t('ui.refresh.models')} disabled={pickerBusy} onClick={() => void openModelPicker(true)}>↻</button><button type="button" title={t('ui.close')} onClick={() => setModelPickerOpen(false)}>×</button></span></div>
        {pickerError && <p className="model-picker-message" role="alert">{pickerError}</p>}
        {pickerConfirmation && <div className="model-picker-confirm" role="alert"><p>{pickerConfirmation.message}</p><button disabled={pickerBusy} onClick={() => void pickModel(pickerConfirmation.provider, pickerConfirmation.model, pickerConfirmation.remember, pickerConfirmation.token)}>{t('ui.confirm.this.model')}</button></div>}
        {pickerBusy && <p className="model-picker-message" role="status">{t('ui.loading.model.options')}</p>}
        {pickerProviders.length > 0 && <><label className="model-picker-provider">{t('ui.provider')}<select value={pickerProvider} onChange={event => setPickerProvider(event.target.value)}>
          {pickerProviders.map(provider => <option key={provider.slug} value={provider.slug}>{provider.name}</option>)}
        </select></label>
        <div className="model-picker-list">{pickerModels.map(model => <button key={model} disabled={pickerBusy || turnBusy} onClick={() => void pickModel(pickerProvider, model)}>
          <span>{model}</span>{activeModel?.provider === pickerProvider && activeModel.model === model && <small>✓</small>}
        </button>)}{pickerModels.length === 0 && <p className="model-picker-message">{t('ui.this.provider.currently.has.no.model.candidates.please.fill.in.the.model.id')}</p>}</div>
        <div className="model-picker-add"><input aria-label={t('ui.add.model.id')} value={pickerModelInput} onChange={event => setPickerModelInput(event.target.value)} maxLength={256} placeholder={t('ui.add.model.id.short')} /><button disabled={pickerBusy || turnBusy || !pickerModelInput.trim()} onClick={() => void pickModel(pickerProvider, pickerModelInput, true)}>{t('ui.add.model.short')}</button></div></>}
        {!pickerBusy && pickerProviders.length === 0 && <p className="model-picker-message">{t('ui.no.available.models')}</p>}
        <button className="model-picker-settings" onClick={() => { setModelPickerOpen(false); openView('model') }}>{t('ui.add.provider.or.configure.model')} →</button>
      </div>}
      </div><small className="composer-hint">{draggingFiles ? t("ui.release.to.stage.file") : t("ui.files.can.be.dragged.in.individual.attachments.cannot.exceed.20.mib")}</small><p role="status" className="chat-status">{localizeAppMessage(language, chatStatus)}</p></div>
      </>}
    </section>}
    </main>
  </div>
}

export default App
