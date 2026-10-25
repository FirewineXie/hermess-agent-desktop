export type Unsubscribe = () => void

export type { DesktopFailure } from './generated/desktop-failure'
import type { DesktopFailure } from './generated/desktop-failure'
export type DesktopFailureCode = DesktopFailure['code']
export type DesktopFailureCategory = DesktopFailure['category']

const failureCategories: Record<DesktopFailureCode, DesktopFailureCategory> = {
  operation_failed: 'operation',
  runtime_unavailable: 'runtime',
  connection_lost: 'connection',
  timeout: 'connection',
  conflict: 'validation',
  invalid_input: 'validation',
}

export function isDesktopFailure(value: unknown): value is DesktopFailure {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.kind === 'desktop_failure'
    && typeof candidate.code === 'string'
    && Object.hasOwn(failureCategories, candidate.code)
    && candidate.category === failureCategories[candidate.code as DesktopFailureCode]
}

export type { BackendInfo } from './generated/backend-info'
import type { BackendInfo } from './generated/backend-info'
export type { BundledToolsInventory } from './generated/bundled-tools-inventory'
import type { BundledToolsInventory } from './generated/bundled-tools-inventory'
export type { DevDefaults } from './generated/dev-defaults'
import type { DevDefaults } from './generated/dev-defaults'
export type { GatewayEvent } from './generated/gateway-event'
import type { GatewayEvent } from './generated/gateway-event'
export type { GatewayRequest } from './generated/gateway-request'
import type { GatewayRequest } from './generated/gateway-request'
export type { ReplayResult } from './generated/replay-result'
import type { ReplayResult } from './generated/replay-result'
export type { PackedDefaults } from './generated/packed-defaults'
import type { PackedDefaults } from './generated/packed-defaults'
export type { RuntimeProbe } from './generated/runtime-probe'
import type { RuntimeProbe } from './generated/runtime-probe'
export type AgentToolset = { name: string; description: string; tool_count: number; enabled: boolean; tools?: string[] }
export type AgentToolCatalog = { toolsets: AgentToolset[] }
export type ActiveAgentTools = { sections: Array<{ name: string; tools: Array<{ name: string; description: string }> }>; total: number }
export type DownloadableTool = { name: string; version: string; installed: boolean; supported: boolean }
export type AgentConfigField = { type: string; description?: string; category?: string; options?: unknown[] }
export type AgentConfigSchema = { fields: Record<string, AgentConfigField>; category_order: string[] }
export type AgentRawConfig = { yaml: string; path: string }
export type PersonalFileKind = 'soul' | 'memory' | 'user'
export type PersonalFile = {
  kind: PersonalFileKind; path: string; exists: boolean; content: string; entries: string[]
  version: string; limit: number | null; enabled: boolean | null
}
export type ProjectFile = { path: string; label: string; status: string; loaded: boolean; chars: number }
export type EditableFile = { path: string; exists: boolean; content: string; version: string }
export type AuxiliaryRoute = { task: string; provider: string; model: string; effort: string; timeout: number | null }
export type ModelProvider = { slug: string; name: string; models: string[]; authenticated?: boolean; auth_type?: string; api_url?: string; is_current?: boolean; is_user_defined?: boolean }
export type ModelOptions = { providers: ModelProvider[]; model?: string; provider?: string }
export type CustomEndpoint = { id: string; name: string; base_url: string; model: string; models: string[]; source: string; is_current: boolean }
export type ModelPickResult = { model?: string; provider?: string; status?: string; confirm_required?: boolean; confirm?: string; confirm_message?: string }
export type ModelAssignment = { ok?: boolean; model?: string; provider?: string; confirm_required?: boolean; confirm_message?: string }
export type { SavedModelConfig } from './generated/saved-model-config'
import type { SavedModelConfig } from './generated/saved-model-config'
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
export type SessionRow = { id: string; title?: string; preview?: string; source?: string; message_count?: number }
export type ProfileRow = { name: string; display_name?: string; is_default: boolean; model?: string | null; provider?: string | null }
export type ProfilesSnapshot = {
  profiles: ProfileRow[]
  selected: string
  gateway_mode: string | null
  gateways: Array<{ profile: string; served_profiles?: string[] }>
  reason: string | null
}
export type PendingAttachment = { kind: 'image' | 'file'; name: string; source_path: string; bytes: number; preview?: string; path?: string; ref_text?: string }
export type CommandCatalog = {
  pairs: Array<[string, string]>
  skills: Record<string, { usage: number; origin: string }>
  commands: Record<string, { desktop?: string | null }>
  categories?: Array<{ name: string; pairs: Array<[string, string]> }>
  plugin_commands?: Record<string, string>
  warning?: string
}
export type CommandResult = { type?: string; output?: string; message?: string; display?: string; notice?: string }
export type ResumeResult = {
  session_id: string
  info?: { provider?: string; model?: string; cwd?: string; launch_request?: { cwd?: string; cwd_explicit?: boolean } }
  stored_session_id?: string
  session_key?: string
  messages: Array<{ role: string; content?: unknown; text?: string | null; tool_name?: string; name?: string; context?: string; args?: Record<string, unknown>; tool_call_id?: string; timestamp?: number; reasoning?: unknown; reasoning_content?: unknown; reasoning_details?: unknown }>
  running?: boolean
  replay_epoch?: string
  last_sequence?: number
  inflight?: { assistant?: string; user?: string }
  open_requests?: GatewayRequest[]
}
export type ChatUsage = { context_tokens?: number; last_prompt_tokens?: number; context_length?: number; config_context_length?: number | null; context_used?: number; context_max?: number; context_percent?: number; context_source?: string; context_estimated?: boolean }

export type UsagePeriodDays = 7 | 30 | 90
export type UsageStatistics = {
  daily: Array<{ day: string; input_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null; api_calls: number | null; estimated_cost: number | null }>
  totals: { total_input: number | null; total_output: number | null; total_reasoning: number | null; total_cache_read: number | null; total_sessions: number; total_api_calls: number | null; total_estimated_cost: number | null }
  models: Array<{ model: string; provider: string; input_tokens: number; output_tokens: number; reasoning_tokens: number; cache_read_tokens: number; api_calls: number; estimated_cost: number | null }>
  period_days: UsagePeriodDays
}

export type NativeDropEvent =
  | { type: 'drop'; paths: string[] }
  | { type: 'enter' | 'over' | 'leave' }

export type NativeOpenOptions = {
  directory: boolean
  multiple: boolean
  title: string
}

export type ProductInfo = {
  version: string
  hermesVersion: string
  hermesCommit: string
  productLicense: string
  hermesLicense: string
}

export type UpdateAsset = { id: number; name: string; size: number; sha256: string }
export type UpdateRelease = {
  tagName: string
  version: string
  channel: 'stable' | 'rc'
  eligible: boolean
  asset: UpdateAsset | null
}
export type UpdateLookup = { status: 'available' | 'unavailable'; releases: UpdateRelease[] }
export type UpdateDownloadProgress = { tagName: string; downloaded: number; total: number }

export type ChannelStatus = { id: string; name: string; enabled: boolean; configured: boolean; state?: string; error_code?: string | null }
export type ChannelQrStart = { id: string; url: string; expires_in: number; poll_interval: number }
export type ChannelQrPoll = { status: 'waiting' | 'scanned' | 'connected' | 'expired'; restart_required: boolean }
export type GracefulRestartResult = { status: 'restarted'; info: BackendInfo } | { status: 'deferred' }

/** The host capability boundary. Frontend features call named capabilities, never native command strings. */
export interface DesktopApi {
  workspacePanel: {
    browserFrame(sessionId: string, targetId?: string): Promise<{ image: string; target: { id: string; title: string; url: string }; targets: Array<{ id: string; title: string; url: string }> }>
    browserCommand(sessionId: string, targetId: string, method: string, params: Record<string, unknown>): Promise<void>
    readFile(path: string): Promise<{ path: string; name: string; kind: 'text' | 'image' | 'unsupported'; content: string; mime?: string }>
    startTerminal(cwd?: string): Promise<{ id: string; cwd: string }>
    writeTerminal(id: string, data: string): Promise<void>
    resizeTerminal(id: string, cols: number, rows: number): Promise<void>
    closeTerminal(id: string): Promise<void>
    onTerminalOutput(handler: (event: { id: string; data: string; closed: boolean }) => void): Promise<Unsubscribe>
    createBrowser(id: string, url: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>
    positionBrowser(id: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>
    showBrowser(id: string, visible: boolean): Promise<void>
    browserAction(id: string, action: 'back' | 'forward' | 'reload'): Promise<void>
    closeBrowser(id: string): Promise<void>
  }
  channels: {
    status(): Promise<{ platforms: ChannelStatus[] }>
    start(platform: 'feishu' | 'weixin'): Promise<ChannelQrStart>
    poll(id: string): Promise<ChannelQrPoll>
    cancel(id: string): Promise<void>
  }
  about: {
    productInfo(): Promise<ProductInfo>
    checkUpdates(): Promise<UpdateLookup>
    downloadUpdate(tagName: string, assetId: number): Promise<string>
    onDownloadProgress(handler: (progress: UpdateDownloadProgress) => void): Promise<Unsubscribe>
  }
  extensions: {
    request<T>(operation: string, payload?: Record<string, unknown>): Promise<T>
  }
  runtime: {
    devDefaults(): Promise<DevDefaults>
    packedDefaults(): Promise<PackedDefaults>
    startDev(storagePath: string, pythonPath: string): Promise<BackendInfo>
    startPacked(storagePath: string): Promise<BackendInfo>
    ping(): Promise<void>
    reconnect(): Promise<BackendInfo>
    restartGracefully(): Promise<GracefulRestartResult>
    stop(): Promise<void>
    probeLocalTools(): Promise<RuntimeProbe[]>
  }
  profiles: {
    list(): Promise<ProfilesSnapshot>
    create(name: string): Promise<{ ok: boolean; name: string }>
    select(name: string): Promise<void>
  }
  tools: {
    listAgentToolsets(sessionId: string | null): Promise<AgentToolCatalog>
    listActiveAgentTools(sessionId: string | null): Promise<ActiveAgentTools>
    listBundledTools(): Promise<BundledToolsInventory>
    listDownloadableTools(): Promise<DownloadableTool[]>
    installDownloadableTool(name: string): Promise<void>
  }
  diagnostics: {
    readLogs(storagePath: string, source: 'hermes' | 'client'): Promise<string>
    recordEvent(storagePath: string, event: string): Promise<void>
  }
  agentSettings: {
    schema(): Promise<AgentConfigSchema>
    config(): Promise<Record<string, unknown>>
    raw(): Promise<AgentRawConfig>
    saveField(key: string, value: unknown): Promise<void>
    saveRaw(yamlText: string, expectedYaml: string): Promise<void>
    saveAuxiliary(route: AuxiliaryRoute): Promise<void>
  }
  personalFiles: {
    read(kind: PersonalFileKind): Promise<PersonalFile>
    save(args: { kind: PersonalFileKind; content?: string; entries?: string[]; expectedVersion: string }): Promise<PersonalFile>
    listProject(sessionId: string): Promise<ProjectFile[]>
    readProject(sessionId: string, path: string): Promise<EditableFile>
    saveProject(args: { sessionId: string; path: string; content: string; expectedVersion: string }): Promise<EditableFile>
  }
  models: {
    options(args: { refresh: boolean; includeUnconfigured?: boolean; sessionId?: string }): Promise<ModelOptions>
    savedConfig(): Promise<SavedModelConfig>
    endpoints(): Promise<{ endpoints: CustomEndpoint[] }>
    loadLists(storagePath: string): Promise<Record<string, string[]> | null>
    saveLists(storagePath: string, lists: Record<string, string[]>): Promise<void>
    addEndpoint(args: { name: string; baseUrl: string; model: string; apiKey: string }): Promise<void>
    deleteEndpoint(endpointId: string): Promise<void>
    setDefault(args: { provider: string; model: string; baseUrl: string; apiKey: string; confirmExpensiveModel: boolean }): Promise<ModelAssignment>
    checkRuntime(): Promise<{ ok?: boolean; provider?: string; model?: string; error?: string }>
    selectChat(args: { sessionId: string; provider: string; model: string; confirm?: string }): Promise<ModelPickResult>
  }
  usage: {
    statistics(days: UsagePeriodDays): Promise<UsageStatistics>
  }
  chat: {
    createSession(cwd?: string): Promise<{ session_id: string; stored_session_id: string; info?: ResumeResult['info'] }>
    resumeSession(sessionId: string): Promise<ResumeResult>
    listSessions(): Promise<{ sessions: SessionRow[] }>
    submitPrompt(sessionId: string, text: string): Promise<{ status?: string }>
    interruptSession(sessionId: string): Promise<{ status: string }>
    replayEvents(sessionId: string, lastSeen: number, replayEpoch: string): Promise<ReplayResult>
    usage(sessionId: string): Promise<ChatUsage>
    reasoning(sessionId: string): Promise<{ value?: string }>
    setReasoning(sessionId: string, value: string): Promise<{ value?: string }>
    commands(sessionId: string): Promise<CommandCatalog>
    executeCommand(sessionId: string, command: string): Promise<CommandResult>
    dispatchSkill(sessionId: string, name: string, arg: string): Promise<CommandResult>
    attachFile(sessionId: string, path: string): Promise<PendingAttachment>
    detachImage(sessionId: string, path: string): Promise<void>
    answerRequest(args: { requestId: string; method: 'approval' | 'clarify'; choice?: ApprovalChoice; answers?: Record<string, string> }): Promise<void>
  }
  events: {
    onGatewayEvent(handler: (event: GatewayEvent) => void): Promise<Unsubscribe>
    onGatewayRequest(handler: (request: GatewayRequest) => void): Promise<Unsubscribe>
    onDisconnect(handler: () => void): Promise<Unsubscribe>
  }
  nativeFiles: {
    choose(options: NativeOpenOptions): Promise<string | string[] | null>
    onDrop(handler: (event: NativeDropEvent) => void): Promise<Unsubscribe>
  }
}
