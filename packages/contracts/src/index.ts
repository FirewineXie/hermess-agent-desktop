import type { ProviderCopyPreview, ProviderCopyResult, DelegationRouting, DevicePreferences, DeviceStatus, QuickTarget, QuickSubmission } from './settings-capabilities'
import type { SharedMetricsConsent, CheckpointInventory, RawConfigWriteResult, ConfigWriteResult, ConfigFileResult } from './configuration'
export * from './configuration'
export type Unsubscribe = () => void

/** Every profile-owned operation carries its owner explicitly. */
export type ProfileScope = { kind: 'profile'; profile: string }
export type PersonalTask = {
  id: string; title: string; body: string | null; status: string; profile: string
  created_at: number; result: string | null; summary: string | null
  failure: string | null; block_kind: string | null
  assignee?: string | null; priority?: number
  progress?: { done: number; total: number } | null
  link_counts?: { parents: number; children: number }
}
export type PersonalTaskDetail = {
  task: PersonalTask
  comments: Array<{ id: number; author: string; body: string; created_at: number }>
  events: Array<{ id: number; kind: string; created_at: number }>
  attachments: Array<{ id: number; filename: string; content_type: string | null; size: number }>
  links?: { parents: string[]; children: string[] }
  link_tasks?: Array<{ id: string; title: string; status: string }>
  child_results?: Array<{ id: string; title: string; status: string; latest_summary: string | null; result: string | null }>
  termination_pending?: boolean
}
export type SessionScope = { kind: 'session'; profile: string; sessionId: string }
export type GatewayScope = { kind: 'gateway' }
export type WebviewCacheSettings = { strategy: 'size' | 'time' | 'unsupported'; value: number }
export type WorkspaceScope = { kind: 'workspace'; path: string; owner?: SessionScope }
export type OperationScope = ProfileScope | SessionScope | GatewayScope | WorkspaceScope

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
  pairing_not_found: 'validation',
  pairing_locked: 'validation',
  session_owner_unknown: 'validation',
  session_profile_mismatch: 'validation',
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

export type ChatWindowContext = {
  target: { profile: string; sessionId: string }
  backend: BackendInfo | null
  storagePath: string
}
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
export type DownloadableTool = { name: string; version: string; installed: boolean; supported: boolean }
export type ProfileToolset = {
  name: string; label: string; description: string; platform: string
  platform_label: string; enabled: boolean; configured: boolean; tools: string[]
}
export type AgentConfigField = { type: string; description?: string; category?: string; options?: unknown[] }
export type AgentConfigSchema = { fields: Record<string, AgentConfigField>; category_order: string[] }
export type AgentRawConfig = { yaml: string; path: string }
export * from './settings-capabilities'
export type PersonalFileKind = 'soul' | 'memory' | 'user'
export type PersonalFile = {
  kind: PersonalFileKind; path: string; exists: boolean; content: string; entries: string[]
  version: string; limit: number | null; enabled: boolean | null
}
export type AuxiliaryTaskAssignment = {
  task: string; provider: string; model: string; base_url: string; reasoning_effort?: string | null
  local_endpoint?: boolean; label?: string; hint?: string; plugin?: string; inherit_from?: string | null
  effective?: { provider: string; model: string; base_url: string }
}
export type AuxiliaryModels = { tasks: AuxiliaryTaskAssignment[]; main: { provider: string; model: string } }
export type AuxiliaryRoute = {
  task: string; provider: string; model: string; effort: string; timeout: number | null
  confirmExpensiveModel?: boolean
}
export type AuxiliarySaveResult = {
  saved: boolean; confirm_required?: boolean; confirm_message?: string; state?: AuxiliaryModels
}
export type MemoryProviderSummary = { name: string; description: string; available: boolean; configured: boolean; status: string }
export type MemoryProviderField = { key: string; label: string; kind: 'bool' | 'json' | 'number' | 'secret' | 'select' | 'text'; description: string; placeholder: string; group: string; is_set: boolean; value: string; options: Array<{ value: string; label: string }> }
export type MemoryProviderConfig = { name: string; label: string; fields: MemoryProviderField[] }
export type MemoryOAuthStatus = { state: 'idle' | 'pending' | 'connected' | 'error'; connected: boolean }
export type ModelProvider = { slug: string; name: string; models: string[]; authenticated?: boolean; auth_type?: string; api_url?: string; is_current?: boolean; is_user_defined?: boolean }
export type ModelOptions = { providers: ModelProvider[]; model?: string; provider?: string }
export type CustomEndpoint = { id: string; name: string; base_url: string; model: string; models: string[]; source: string; is_current: boolean; discover_models?: boolean }
export type ModelPickResult = { model?: string; provider?: string; status?: string; confirm_required?: boolean; confirm?: string; confirm_message?: string }
export type ModelAssignment = { ok?: boolean; model?: string; provider?: string; confirm_required?: boolean; confirm_message?: string }
export type ModelOAuthProviderStatus = {
  logged_in: boolean
  source: string | null
  source_label: string | null
  token_preview: string | null
  expires_at: string | null
  has_refresh_token: boolean
  last_refresh: string | null
  error: string | null
}
export type ModelOAuthProvider = {
  id: string
  name: string
  flow: 'device_code' | 'external' | 'pkce'
  cli_command: string
  docs_url: string | null
  disconnect_hint: string | null
  disconnect_command: string | null
  disconnectable: boolean
  status: ModelOAuthProviderStatus
}
export type ModelOAuthStart = {
  session_id: string
  flow: 'device_code'
  user_code: string
  verification_url: string
  expires_in: number
  poll_interval: number
}
export type ModelOAuthPoll = {
  session_id: string
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'error' | 'cancelled'
  error_message: string | null
  expires_at: number | null
  reason: string | null
  retryable: boolean
  retry_after: number | null
}
export type MoaModelSlot = { provider: string; model: string; reasoning_effort?: string; enabled?: boolean }
export type MoaPreset = {
  aggregator: MoaModelSlot
  aggregator_temperature: number | null
  degraded_reference_policy: 'loud' | 'silent'
  enabled: boolean
  reference_models: MoaModelSlot[]
  reference_temperature: number | null
  fanout?: string
  reference_timeout: number | null
}
export type MoaConfig = MoaPreset & { default_preset: string; active_preset: string; presets: Record<string, MoaPreset> }
export type { SavedModelConfig } from './generated/saved-model-config'
import type { SavedModelConfig } from './generated/saved-model-config'
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
export type SessionRow = { id: string; session_id?: string; title?: string; preview?: string; source?: string; message_count?: number; running?: boolean }
export type ProfileRow = { name: string; display_name?: string; is_default: boolean; model?: string | null; provider?: string | null; description?: string; description_auto?: boolean }
export type BotRosterRow = ProfileRow & { canonical_session?: { id: string; resolved_id: string; title: string; preview: string; last_active: number } | null; ui_meta?: Record<string, unknown> }
export type BotRoster = { profiles: BotRosterRow[]; bot_mode_protocol: boolean; install_id: string }
export type BotGroupMember = { member_id: string; profile: string; handle: string; display_name?: string }
export type BotGroup = { room_id: string; name: string; members: BotGroupMember[]; latest_seq?: number; disbanded_at?: number | null }
export type BotGroupEvent = { room_id: string; seq: number; event_id: string; kind: string; actor: { kind: string; id: string }; payload: Record<string, unknown>; created_at: number }
export type BotGroupCapabilities = { driver: boolean; seatable_profiles?: string[]; max_log_limit: number }
export type ProfileDataListing = { path: string; relativePath: string; parent: string | null; entries: Array<{ name: string; relativePath: string; directory: boolean; link: boolean }> }
export type ProfilesSnapshot = {
  profiles: ProfileRow[]
  selected: string
  gateway_mode: string | null
  gateways: Array<{ profile: string; served_profiles?: string[] }>
  reason: string | null
}
export type PersonalityEntry = { name: string; description: string; source: 'hermes' | 'custom' }
export type PersonalitiesSnapshot = { profile: string; active: string; entries: PersonalityEntry[] }
export type ProfilePresetSelection = { personalityName: string; personalityPrompt: string; skills: string[]; mcp: string[] }
export type ProfileMcpServerCreate = {
  name: string
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  auth?: 'none' | 'oauth' | 'header'
  bearer_token?: string
}
export type McpOAuthFlow = {
  flow_id: string
  authorization_url?: string | null
  status: string
  error?: string | null
}
export type McpOAuthCancelResult = { ok: boolean; status: string }
export type ProfileCreateOptions = {
  preset?: ProfilePresetSelection
  cloneFrom?: string | null
  cloneAll?: boolean
  description?: string
  provider?: string
  model?: string
  noSkills?: boolean
  keepSkills?: string[]
  hubSkills?: string[]
  mcpServers?: ProfileMcpServerCreate[]
}
export type ProfileCreateResult = { ok?: boolean; name: string; personality_applied?: boolean; warnings?: string[]; hub_installs?: Array<{ identifier: string; action: string | null }> }
export type WorkBuddyImportPreview = {
  packageName: string; version: string; displayName: string; profileName: string
  lead: string; members: string[]; skills: string[]; mcpCount: number
  scriptCount: number; fileCount: number; totalBytes: number; digest: string; soul: string
  notices: string[]
}
export type PendingAttachment = { kind: 'image' | 'file'; name: string; source_path: string; bytes: number; preview?: string; image_preview?: string; path?: string; mime?: string; ref_text?: string; content_base64?: string }
export type ChatImageAttachment = { path: string; mime: string }
export type CommandCatalog = {
  pairs: Array<[string, string]>
  skills: Record<string, { usage: number; origin: string }>
  commands: Record<string, { desktop?: string | null; argument_mode?: string | null; desktop_subcommands?: string[] }>
  sub?: Record<string, string[]>
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
export type SubagentRow = { subagent_id: string; parent_id?: string | null; depth?: number | null; goal?: string | null; model?: string | null; started_at?: number | null; status?: string | null; tool_count?: number | null; last_tool?: string | null; accepting_steer?: boolean | null }
export type SubagentRoster = { subagents: SubagentRow[]; delegations: unknown[] }
export type SubagentTail = { subagent_id: string; available: boolean; text: string; truncated: boolean }
export type RollbackCheckpoint = { hash: string; timestamp: string; message: string }
export type RollbackListResult = { enabled: boolean; checkpoints: RollbackCheckpoint[] }
export type RollbackDiffResult = { stat: string; diff: string; rendered?: string | null }
export type RollbackRestoreResult = {
  success: boolean
  restored_to?: string | null
  reason?: string | null
  directory?: string | null
  file?: string | null
  restored_files?: string[] | null
  skipped_user_edits?: string[] | null
  skipped_oversize?: string[] | null
  failed_deletes?: string[] | null
  history_removed?: number | null
  error?: string | null
}

export type UsagePeriodDays = 7 | 30 | 90
export type ModelUsageStatistics = {
  models: UsageStatistics['models']
  totals: { distinct_models: number; total_sessions: number }
  period_days: UsagePeriodDays
}
export type UsageStatistics = {
  daily: Array<{ day: string; sessions: number; input_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null; api_calls: number | null; estimated_cost: number | null }>
  totals: { total_input: number | null; total_output: number | null; total_reasoning: number | null; total_cache_read: number | null; total_sessions: number; total_api_calls: number | null; total_estimated_cost: number | null }
  models: Array<{ model: string; provider: string; sessions: number; input_tokens: number; output_tokens: number; reasoning_tokens: number; cache_read_tokens: number; api_calls: number; estimated_cost: number | null; last_used_at?: number | null; tool_calls?: number | null; avg_tokens_per_session?: number | null; capabilities?: { supports_tools?: boolean; supports_vision?: boolean; supports_reasoning?: boolean; context_window?: number; max_output_tokens?: number; model_family?: string } }>
  skills: Array<{ skill: string; view_count: number; manage_count: number; total_count: number; last_used_at: number | null }>
  period_days: UsagePeriodDays
}

export type SessionManagementMessage = {
  role?: string
  content?: unknown
  display_content?: unknown
}

export type SessionManagementMessagePage = {
  session_id: string
  profile: string
  messages: SessionManagementMessage[]
  pagination: {
    limit: number
    offset: number
    order: 'oldest' | 'latest'
    returned: number
  }
}

export type SessionManagementHealth = {
  gateway_running: boolean
  gateway_state?: string | null
  gateway_exit_reason?: string | null
  gateway_platforms: Record<string, { state?: string | null; error_code?: string | null; error_message?: string | null }>
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
export type SystemStats = {
  os: string
  os_release: string
  arch: string
  hostname: string
  python_version: string
  python_impl: string
  hermes_version: string
  cpu_count: number | null
  psutil: boolean
  cpu_percent?: number
  load_avg?: number[]
  uptime_seconds?: number
  memory?: { total: number; used: number; percent: number }
  disk?: { total: number; used: number; percent: number }
  process?: { pid: number; rss: number; num_threads: number }
}

export type UpdateAsset = { id: number; name: string; size: number; sha256: string }
export type UpdateRelease = {
  tagName: string
  version: string
  channel: 'stable' | 'rc'
  eligible: boolean
  asset: UpdateAsset | null
}
export type UpdateLookup = { status: 'available' | 'unavailable' | 'rate_limited'; releases: UpdateRelease[] }
export type UpdateDownloadStatus = { state: 'idle' | 'downloading' | 'completed' | 'failed'; tagName: string; assetId: number; downloaded: number; total: number; path: string | null; error: DesktopFailure | null }

export type ChannelField = { key: string; prompt: string; help: string; required: boolean; is_set: boolean; is_password: boolean; is_list: boolean; value?: string | null }
export type WhatsAppMode = 'bot' | 'self-chat'
export type WhatsAppSetupSummary = { mode: WhatsAppMode | ''; allowed_users_set: boolean; home_channel_set: boolean }
export type ChannelStatus = { id: string; name: string; description?: string | null; docs_url?: string | null; enabled: boolean; configured: boolean; supported: boolean; state?: string; error_code?: string | null; error_message?: string | null; ingress_url?: string | null; fields?: ChannelField[]; whatsapp_setup?: WhatsAppSetupSummary | null }
export type ChannelTest = { ok: boolean; state: string; auth_posture?: string | null }
export type TelegramSetupStart = { id: string; url: string; expires_in: number }
export type TelegramSetupPoll = { status: 'waiting' | 'ready' | 'expired'; owner_user_id?: string | null }
export type VendorQrStart = { id: string; url: string; poll_interval: number }
export type VendorQrPoll = { status: 'waiting' | 'ready' | 'expired' }
export type WhatsAppSetupOptions = { mode: WhatsAppMode; allowedUsers: string; resetSession: boolean }
export type WhatsAppApplyOptions = { mode: WhatsAppMode; allowedUsers: string }
export type WhatsAppQr = {
  id: string; status: 'waiting' | 'ready'; qr_payload?: string | null; mode: WhatsAppMode; allowed_users: string;
  account_id?: string | null; account_name?: string | null; account_phone?: string | null
}
export type WhatsAppQrPoll = {
  status: 'waiting' | 'ready' | 'expired' | 'failed'; qr_payload?: string | null; mode?: WhatsAppMode; allowed_users?: string;
  account_id?: string | null; account_name?: string | null; account_phone?: string | null
}
export type ChannelSave = { env: Record<string, string>; clear_env: string[]; enabled?: boolean }
export type ChannelQrStart = { id: string; url: string; expires_in: number; poll_interval: number }
export type ChannelQrPoll = { status: 'waiting' | 'scanned' | 'connected' | 'expired'; restart_required: boolean }
export type ChannelAccess = 'pairing' | 'open'
export type GracefulRestartResult = { status: 'restarted'; info: BackendInfo } | { status: 'deferred' }
export type RemoteGatewayConfig = { id: string; label: string; url: string }
export type RemoteGatewayProbe = { profiles: string[] }
export type ActiveGateway = { mode: 'local' } | { mode: 'remote'; config: RemoteGatewayConfig; replay_epoch: string; selected_profile: string }

export type NotificationTarget = {
  connectionId: string
  profile: string
  sessionId: string
  taskId?: string
  approvalRequestId?: string
  locale: 'zh-CN' | 'en-US'
}
export type NotificationAction = {
  target: NotificationTarget
  kind: 'open' | 'approval'
  choice?: 'once' | 'deny'
}

export type KanbanEventMessage = {
  subscription: string
  board: string
  kind: 'frame' | 'closed'
  cursor?: number
  events?: Array<{ id: number; task_id?: string | null; kind: string; created_at?: number }>
  reason?: 'ended' | 'invalid_frame' | 'read_failed'
}
export type DashboardPluginSocketEvent = {
  subscription: string
  kind: 'message' | 'closed'
  data?: string
  binary_base64?: string
  reason?: 'ended' | 'read_failed' | 'write_failed' | 'invalid_frame'
}
export type DashboardPluginSocket = {
  send(data: string, binary?: boolean): Promise<void>
  close(): void
}
export type HermesConsoleSocketEvent = {
  subscription: string
  kind: 'message' | 'closed'
  data?: string
  reason?: 'ended' | 'read_failed' | 'write_failed' | 'invalid_frame'
}
export type HermesConsoleSocket = {
  send(frame: Record<string, unknown>): Promise<void>
  close(): void
}

/** The host capability boundary. Frontend features call named capabilities, never native command strings. */
export interface DesktopApi {
  hermesConsole: {
    socket(scope: ProfileScope, handler: (event: HermesConsoleSocketEvent) => void): Promise<HermesConsoleSocket>
  }
  dashboardPlugins: {
    socket(scope: ProfileScope, path: string, handler: (event: DashboardPluginSocketEvent) => void): Promise<DashboardPluginSocket>
  }
  kanbanDashboard: {
    request(path: string, method: string, body?: unknown, upload?: { filename: string; content_type: string; data_base64: string }): Promise<{ status: number; body?: unknown; content_type?: string; body_base64?: string }>
    events(board: string, since: number, handler: (message: KanbanEventMessage) => void): Promise<Unsubscribe>
  }
  personalTasks: {
    capabilities(scope: ProfileScope): Promise<{ version: number; capabilities: string[] }>
    list(scope: ProfileScope): Promise<{ tasks: PersonalTask[] }>
    create(scope: ProfileScope, requestId: string, title: string, body: string, triage?: boolean): Promise<PersonalTaskDetail>
    detail(scope: ProfileScope, taskId: string): Promise<PersonalTaskDetail>
    decompose(scope: ProfileScope, taskId: string): Promise<{ ok: boolean; reason: string | null; detail: PersonalTaskDetail }>
    reply(scope: ProfileScope, taskId: string, requestId: string, body: string): Promise<PersonalTaskDetail>
    resume(scope: ProfileScope, taskId: string, requestId: string): Promise<PersonalTaskDetail>
    archive(scope: ProfileScope, taskId: string): Promise<PersonalTaskDetail>
    events(scope: ProfileScope, after: number): Promise<{ events: Array<{ id: number; task_id: string; kind: string; created_at: number }>; next: number }>
  }
  links: {
    openRepository(): Promise<void>
    openDocumentation(): Promise<void>
  }
  windowChrome: {
    customTitlebar: boolean
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
  }
  chatWindows: {
    open(profile: string, sessionId: string): Promise<string>
    context(): Promise<ChatWindowContext>
  }
  notifications: {
    permission(): Promise<boolean>
    requestPermission(): Promise<boolean>
    show(title: string, body: string, target?: NotificationTarget): Promise<void>
    onAction(handler: (action: NotificationAction) => void): Promise<Unsubscribe>
  }
  workspacePanel: {
    listDirectory(scope: WorkspaceScope, path?: string): Promise<{ path: string; name: string; entries: Array<{ path: string; name: string; directory: boolean }> }>
    readFile(scope: WorkspaceScope, path: string): Promise<{ path: string; name: string; kind: 'text' | 'image' | 'unsupported'; content: string; mime?: string }>
    startTerminal(scope: WorkspaceScope): Promise<{ id: string; cwd: string }>
    activateTerminal(scope: WorkspaceScope, id: string): Promise<void>
    writeTerminal(scope: WorkspaceScope, id: string, data: string): Promise<void>
    resizeTerminal(scope: WorkspaceScope, id: string, cols: number, rows: number): Promise<void>
    closeTerminal(scope: WorkspaceScope, id: string): Promise<void>
    onTerminalOutput(handler: (event: { id: string; scope: WorkspaceScope; data: string; closed: boolean }) => void): Promise<Unsubscribe>
  }
  localPreview: {
    readHtml(path: string): Promise<{ path: string; content: string }>
  }
  channels: {
    status(scope: ProfileScope): Promise<{ platforms: ChannelStatus[] }>
    save(scope: ProfileScope, platform: string, update: ChannelSave): Promise<{ hot_served: boolean }>
    test(scope: ProfileScope, platform: string): Promise<ChannelTest>
    telegramStart(scope: ProfileScope): Promise<TelegramSetupStart>
    telegramPoll(scope: ProfileScope, id: string): Promise<TelegramSetupPoll>
    telegramApply(scope: ProfileScope, id: string, allowedUserIds: string[]): Promise<void>
    telegramCancel(scope: ProfileScope, id: string): Promise<void>
    vendorQrStart(scope: ProfileScope, platform: 'dingtalk' | 'wecom' | 'qqbot'): Promise<VendorQrStart>
    vendorQrPoll(scope: ProfileScope, id: string): Promise<VendorQrPoll>
    vendorQrApply(scope: ProfileScope, id: string): Promise<void>
    vendorQrCancel(scope: ProfileScope, id: string): Promise<void>
    whatsappStart(scope: ProfileScope, options: WhatsAppSetupOptions): Promise<WhatsAppQr>
    whatsappPoll(scope: ProfileScope, id: string): Promise<WhatsAppQrPoll>
    whatsappApply(scope: ProfileScope, id: string, options: WhatsAppApplyOptions): Promise<void>
    whatsappCancel(scope: ProfileScope, id: string): Promise<void>
    start(scope: ProfileScope, platform: 'feishu' | 'weixin'): Promise<ChannelQrStart>
    poll(scope: ProfileScope, id: string, access: ChannelAccess): Promise<ChannelQrPoll>
    approvePairing(scope: ProfileScope, platform: string, code: string): Promise<void>
    cancel(scope: ProfileScope, id: string): Promise<void>
  }
  about: {
    productInfo(): Promise<ProductInfo>
    checkUpdates(): Promise<UpdateLookup>
    startUpdateDownload(tagName: string, assetId: number): Promise<UpdateDownloadStatus>
    getUpdateDownloadStatus(): Promise<UpdateDownloadStatus>
    onUpdateDownloadStatus(handler: (status: UpdateDownloadStatus) => void): Promise<Unsubscribe>
  }
  extensions: {
    request<T>(scope: ProfileScope, operation: string, payload?: Record<string, unknown>): Promise<T>
    cancelMcpOAuth(scope: ProfileScope, flowId: string): Promise<McpOAuthCancelResult>
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
    savedRemote(): Promise<RemoteGatewayConfig | null>
    testRemote(url: string, token: string): Promise<RemoteGatewayProbe>
    saveRemote(label: string, url: string, token: string): Promise<RemoteGatewayConfig>
    activeGateway(): Promise<ActiveGateway>
    activateSavedRemote(): Promise<ActiveGateway>
    activateLocalGateway(): Promise<ActiveGateway>
    probeLocalTools(): Promise<RuntimeProbe[]>
    systemStats(): Promise<SystemStats>
  }
  profiles: {
    list(): Promise<ProfilesSnapshot>
    dataDirectory(scope: ProfileScope): Promise<{ path: string }>
    listDataDirectory(scope: ProfileScope, relativePath?: string): Promise<ProfileDataListing>
    openDataDirectory(scope: ProfileScope): Promise<void>
    create(name: string, options?: ProfileCreateOptions): Promise<ProfileCreateResult>
    exportArchive(name: string, destination: string): Promise<{ archive: string; bytes: number }>
    importArchive(archive: string, name?: string): Promise<ProfileCreateResult>
    delete(name: string): Promise<{ settlement_pending: boolean }>
    setDisplayName(name: string, displayName: string): Promise<{ display_name: string }>
    identity(name: string): Promise<{ description: string; description_auto: boolean }>
    setupCommand(name: string): Promise<{ command: string }>
    renameId(name: string, newName: string): Promise<{ name: string; selection_persisted: boolean }>
    saveDescription(name: string, description: string): Promise<{ description: string; description_auto: false }>
    describeAuto(name: string, overwrite: boolean): Promise<{ ok: boolean; reason: string | null; description: string | null; description_auto: boolean }>
    inspectImport(path: string): Promise<WorkBuddyImportPreview>
    importPackage(path: string, profileName: string, expectedDigest: string): Promise<ProfileCreateResult>
    activate(name: string): Promise<void>
    listPersonalities(scope: ProfileScope): Promise<PersonalitiesSnapshot>
    listToolsets(scope: ProfileScope): Promise<ProfileToolset[]>
    applyPersonality(scope: ProfileScope, name: string, prompt?: string): Promise<PersonalitiesSnapshot>
  }
  tools: {
    listBundledTools(): Promise<BundledToolsInventory>
    listDownloadableTools(): Promise<DownloadableTool[]>
    installDownloadableTool(name: string): Promise<void>
  }
  diagnostics: {
    readLogs(storagePath: string, source: 'hermes' | 'client' | 'browser'): Promise<string>
    recordEvent(storagePath: string, event: string): Promise<void>
    getWebviewCacheSettings(): Promise<WebviewCacheSettings>
    setWebviewCacheSettings(value: number): Promise<void>
    clearWebviewCacheNow(): Promise<void>
  }
  agentSettings: {
    schema(scope: ProfileScope): Promise<AgentConfigSchema>
    config(scope: ProfileScope): Promise<Record<string, unknown>>
    defaults(scope: ProfileScope): Promise<Record<string, unknown>>
    raw(scope: ProfileScope): Promise<AgentRawConfig>
    saveField(scope: ProfileScope, key: string, value: unknown): Promise<void>
    saveConfig(scope: ProfileScope, config: Record<string, unknown>): Promise<ConfigWriteResult>
    saveRaw(scope: ProfileScope, yamlText: string, expectedYaml: string): Promise<RawConfigWriteResult>
    importJson(scope: ProfileScope, path: string): Promise<Record<string, unknown>>
    exportJson(scope: ProfileScope, path: string, config: Record<string, unknown>): Promise<ConfigFileResult>
    auxiliary(scope: ProfileScope): Promise<AuxiliaryModels>
    saveAuxiliary(scope: ProfileScope, route: AuxiliaryRoute): Promise<AuxiliarySaveResult>
    resetAuxiliary(scope: ProfileScope): Promise<void>
  }
  security: {
    consent(scope: ProfileScope): Promise<SharedMetricsConsent>
    saveConsent(scope: ProfileScope, enabled: boolean, send: boolean): Promise<SharedMetricsConsent>
    checkpoints(scope: ProfileScope): Promise<CheckpointInventory>
  }
  memory: {
    providers(scope: ProfileScope): Promise<{ active: string; providers: MemoryProviderSummary[] }>
    config(scope: ProfileScope, provider: string): Promise<MemoryProviderConfig>
    save(scope: ProfileScope, provider: string, values: Record<string, string>): Promise<void>
    oauthStart(scope: ProfileScope, provider: string): Promise<MemoryOAuthStatus>
    oauthStatus(scope: ProfileScope, provider: string): Promise<MemoryOAuthStatus>
  }
  personalFiles: {
    read(scope: ProfileScope, kind: PersonalFileKind): Promise<PersonalFile>
    save(scope: ProfileScope, args: { kind: PersonalFileKind; content?: string; entries?: string[]; expectedVersion: string }): Promise<PersonalFile>
    reset(scope: ProfileScope, target: 'all' | 'memory' | 'user'): Promise<{ ok: boolean; deleted: string[] }>
  }
  models: {
    previewCopy(scope: ProfileScope, endpointId: string, target: string): Promise<ProviderCopyPreview>
    copy(scope: ProfileScope, preview: ProviderCopyPreview): Promise<ProviderCopyResult>
    options(scope: ProfileScope | SessionScope, args: { refresh: boolean; includeUnconfigured?: boolean }): Promise<ModelOptions>
    savedConfig(scope: ProfileScope): Promise<SavedModelConfig>
    endpoints(scope: ProfileScope): Promise<{ endpoints: CustomEndpoint[] }>
    loadLists(scope: ProfileScope, storagePath: string): Promise<Record<string, string[]> | null>
    saveLists(scope: ProfileScope, storagePath: string, lists: Record<string, string[]>): Promise<void>
    addEndpoint(scope: ProfileScope, args: { name: string; baseUrl: string; model: string; apiKey: string; makeDefault: boolean; discoverModels: boolean }): Promise<void>
    updateEndpoint(scope: ProfileScope, args: { endpointId: string; name: string; baseUrl: string; model: string; apiKey: string | null; makeDefault: boolean; discoverModels: boolean }): Promise<void>
    setEndpointDiscovery(scope: ProfileScope, endpointId: string, discoverModels: boolean): Promise<void>
    deleteEndpoint(scope: ProfileScope, endpointId: string): Promise<void>
    setDefault(scope: ProfileScope, args: { provider: string; model: string; baseUrl: string; apiKey: string; confirmExpensiveModel: boolean }): Promise<ModelAssignment>
    checkRuntime(scope: ProfileScope): Promise<{ ok?: boolean; provider?: string; model?: string; error?: string }>
    selectChat(scope: SessionScope, args: { provider: string; model: string; confirm?: string }): Promise<ModelPickResult>
    moa(scope: ProfileScope): Promise<MoaConfig>
    saveMoa(scope: ProfileScope, config: MoaConfig): Promise<MoaConfig>
    oauthProviders(scope: ProfileScope): Promise<{ providers: ModelOAuthProvider[] }>
    oauthStart(scope: ProfileScope, provider: string): Promise<ModelOAuthStart>
    oauthPoll(scope: ProfileScope, provider: string, sessionId: string): Promise<ModelOAuthPoll>
    oauthCancel(scope: ProfileScope, sessionId: string): Promise<{ ok: boolean }>
    oauthDisconnect(scope: ProfileScope, provider: string): Promise<{ ok: boolean; provider: string }>
  }
  delegation: {
    read(scope: ProfileScope): Promise<DelegationRouting>
    save(scope: ProfileScope, draft: DelegationRouting): Promise<{ routing: DelegationRouting; activated: boolean }>
  }
  device: {
    status(): Promise<DeviceStatus>
    save(preferences: DevicePreferences): Promise<DeviceStatus>
    setQuickTarget(target: QuickTarget | null): Promise<void>
    onQuickSubmit(handler: (submission: QuickSubmission) => void): Promise<Unsubscribe>
    takeQuickSubmission(requestId: string): Promise<QuickSubmission>
    finishQuickSubmission(requestId: string, error: string | null): Promise<void>
  }
  usage: {
    statistics(scope: ProfileScope, days: UsagePeriodDays): Promise<UsageStatistics>
    models(scope: ProfileScope, days: UsagePeriodDays): Promise<ModelUsageStatistics>
  }
  bots: {
    list(): Promise<BotRoster>
    openChat(profile: string): Promise<{ session_id: string; created: boolean }>
    groups<T>(profile: string, operation: string, params: Record<string, unknown>): Promise<T>
  }
  chat: {
    createSession(scope: ProfileScope, args: { cwd?: string; provider?: string; model?: string; reasoning?: string }): Promise<{ session_id: string; stored_session_id: string; info?: ResumeResult['info'] }>
    resumeSession(scope: SessionScope): Promise<ResumeResult>
    listSessions(scope: ProfileScope): Promise<{ sessions: SessionRow[] }>
    deleteSession(scope: SessionScope & { keepView: boolean; viewSessionId: string }): Promise<{ deleted_ids: string[] }>
    submitPrompt(scope: SessionScope, text: string, images?: ChatImageAttachment[]): Promise<{ status?: string }>
    interruptSession(scope: SessionScope): Promise<{ status: string }>
    steerSession(scope: SessionScope, text: string): Promise<{ status: string; delivered?: boolean }>
    askSideQuestion(scope: SessionScope, question: string): Promise<{ task_id?: string; status?: string }>
    startBackgroundTask(scope: SessionScope, prompt: string): Promise<{ task_id?: string; status?: string }>
    replayEvents(scope: SessionScope, lastSeen: number, replayEpoch: string): Promise<ReplayResult>
    usage(scope: SessionScope): Promise<ChatUsage>
    reasoning(scope: ProfileScope | SessionScope): Promise<{ value?: string }>
    setReasoning(scope: SessionScope, value: string): Promise<{ value?: string }>
    commands(scope: ProfileScope | SessionScope): Promise<CommandCatalog>
    executeCommand(scope: SessionScope, command: string): Promise<CommandResult>
    subagents(scope: SessionScope): Promise<SubagentRoster>
    subagentTail(scope: SessionScope, subagentId: string): Promise<SubagentTail>
    steerSubagent(scope: SessionScope, subagentId: string, text: string): Promise<{ status: 'queued' | 'rejected'; subagent_id: string }>
    stopSubagent(scope: SessionScope, subagentId: string): Promise<{ found: boolean; subagent_id: string }>
    rollbackList(scope: SessionScope): Promise<RollbackListResult>
    rollbackDiff(scope: SessionScope, hash: string): Promise<RollbackDiffResult>
    rollbackRestore(scope: SessionScope, args: { hash: string; filePath?: string; all?: boolean }): Promise<RollbackRestoreResult>
    exportSession(scope: SessionScope, format: 'json' | 'md' | 'html', redact: boolean, filename?: string): Promise<string | null>
    dispatchSkill(scope: SessionScope, name: string, arg: string): Promise<CommandResult>
    attachFile(scope: SessionScope, path: string): Promise<PendingAttachment>
    attachImageBytes(scope: SessionScope, contentBase64: string, name: string): Promise<PendingAttachment>
    inspectFile(path: string): Promise<PendingAttachment>
    detachImage(scope: SessionScope, path: string): Promise<void>
    answerRequest(scope: SessionScope, args: { requestId: string; method: 'approval' | 'clarify'; choice?: ApprovalChoice; answers?: Record<string, string | null> }): Promise<void>
  }
  events: {
    onGatewayEvent(handler: (event: GatewayEvent) => void): Promise<Unsubscribe>
    onGatewayRequest(handler: (request: GatewayRequest) => void): Promise<Unsubscribe>
    onDisconnect(handler: () => void): Promise<Unsubscribe>
  }
  nativeFiles: {
    choose(options: NativeOpenOptions): Promise<string | string[] | null>
    save(defaultPath: string): Promise<string | null>
    onDrop(handler: (event: NativeDropEvent) => void): Promise<Unsubscribe>
  }
}
