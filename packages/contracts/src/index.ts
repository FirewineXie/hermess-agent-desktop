export type Unsubscribe = () => void

export type BackendInfo = { port: number; pid: number; replay_epoch: string }
export type DevDefaults = { python_path: string; storage_path: string }
export type PackedDefaults = { storage_path: string; initialized: boolean }
export type RuntimeProbe = {
  tool: string
  kind: 'runtime' | 'command'
  path: string | null
  version: string | null
  usable: boolean
  reason: string
}
export type BundledToolsInventory = { has_manifest: boolean; tools: Array<{ name: string; version: string; path: string; present: boolean }> }
export type AgentToolset = { name: string; description: string; tool_count: number; enabled: boolean; tools?: string[] }
export type AgentToolCatalog = { toolsets: AgentToolset[] }
export type ActiveAgentTools = { sections: Array<{ name: string; tools: Array<{ name: string; description: string }> }>; total: number }
export type AgentConfigField = { type: string; description?: string; category?: string; options?: unknown[] }
export type AgentConfigSchema = { fields: Record<string, AgentConfigField>; category_order: string[] }
export type AgentRawConfig = { yaml: string; path: string }
export type AuxiliaryRoute = { task: string; provider: string; model: string; effort: string; timeout: number | null }
export type ModelProvider = { slug: string; name: string; models: string[]; authenticated?: boolean; auth_type?: string; api_url?: string; is_current?: boolean; is_user_defined?: boolean }
export type ModelOptions = { providers: ModelProvider[]; model?: string; provider?: string }
export type CustomEndpoint = { id: string; name: string; base_url: string; model: string; models: string[]; source: string; is_current: boolean }
export type ModelPickResult = { model?: string; provider?: string; status?: string; confirm_required?: boolean; confirm?: string; confirm_message?: string }
export type ModelAssignment = { ok?: boolean; model?: string; provider?: string; confirm_required?: boolean; confirm_message?: string }
export type SavedModelConfig = { provider: string; model: string; base_url: string }
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
export type GatewayRequest = {
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
export type GatewayEvent = { kind: string; session_id?: string; seq?: number; payload: Record<string, unknown> }
export type ReplayResult = {
  events: Array<{ type: string; session_id?: string; seq?: number; payload?: Record<string, unknown> }>
  latest_seq: number
  epoch: string
  truncated: boolean
  open_requests?: GatewayRequest[]
}
export type SessionRow = { id: string; title?: string; preview?: string; message_count?: number }
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
export type ChatUsage = { context_tokens?: number; last_prompt_tokens?: number; context_length?: number; context_used?: number; context_max?: number; context_percent?: number; context_source?: string; context_estimated?: boolean }

export type DesktopEvent<T> = { payload: T }

export type NativeDropEvent =
  | { type: 'drop'; paths: string[] }
  | { type: 'enter' | 'over' | 'leave' }

export type NativeOpenOptions = {
  directory: boolean
  multiple: boolean
  title: string
}

/** The host capability boundary. Frontend features call named capabilities, never native command strings. */
export interface DesktopApi {
  runtime: {
    devDefaults(): Promise<DevDefaults>
    packedDefaults(): Promise<PackedDefaults>
    startDev(storagePath: string, pythonPath: string): Promise<BackendInfo>
    startPacked(storagePath: string): Promise<BackendInfo>
    ping(): Promise<void>
    reconnect(): Promise<BackendInfo>
    stop(): Promise<void>
    probeLocalTools(): Promise<RuntimeProbe[]>
  }
  tools: {
    listAgentToolsets(sessionId: string | null): Promise<AgentToolCatalog>
    listActiveAgentTools(sessionId: string | null): Promise<ActiveAgentTools>
    listBundledTools(): Promise<BundledToolsInventory>
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
  chat: {
    createSession(): Promise<{ session_id: string; stored_session_id: string; info?: { provider?: string; model?: string } }>
    resumeSession(sessionId: string): Promise<ResumeResult>
    listSessions(): Promise<{ sessions: SessionRow[] }>
    submitPrompt(sessionId: string, text: string): Promise<{ status?: string }>
    interruptSession(sessionId: string): Promise<{ status: string }>
    replayEvents(sessionId: string, lastSeen: number, replayEpoch: string): Promise<ReplayResult>
    usage(sessionId: string): Promise<ChatUsage>
    reasoning(sessionId: string): Promise<{ value?: string }>
    commands(sessionId: string): Promise<CommandCatalog>
    executeCommand(sessionId: string, command: string): Promise<CommandResult>
    dispatchSkill(sessionId: string, name: string, arg: string): Promise<CommandResult>
    attachFile(sessionId: string, path: string): Promise<PendingAttachment>
    detachImage(sessionId: string, path: string): Promise<void>
    answerRequest(args: { requestId: string; method: 'approval' | 'clarify'; choice?: ApprovalChoice; answers?: Record<string, string> }): Promise<void>
  }
  listen<T>(event: string, handler: (event: DesktopEvent<T>) => void): Promise<Unsubscribe>
  open(options: NativeOpenOptions): Promise<string | string[] | null>
  onDragDropEvent(handler: (event: DesktopEvent<NativeDropEvent>) => void): Promise<Unsubscribe>
}
