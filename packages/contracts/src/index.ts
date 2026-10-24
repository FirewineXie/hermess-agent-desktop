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

export type DesktopEvent<T> = { payload: T }

export type NativeDropEvent =
  | { type: 'drop'; paths: string[] }
  | { type: 'enter' | 'over' | 'leave' }

export type NativeOpenOptions = {
  directory: boolean
  multiple: boolean
  title: string
}

/** The host capability boundary. Domain methods replace the transitional invoke API as modules migrate. */
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
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (event: DesktopEvent<T>) => void): Promise<Unsubscribe>
  open(options: NativeOpenOptions): Promise<string | string[] | null>
  onDragDropEvent(handler: (event: DesktopEvent<NativeDropEvent>) => void): Promise<Unsubscribe>
}
