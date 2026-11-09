export type ChatConnectionTarget = {
  name: string
  kind: 'plugin' | 'skill' | 'mcp' | 'connector'
  state: 'pending' | 'initiated' | 'connected' | 'skipped' | 'failed' | 'expired' | 'not_connected'
  action: string
  resolved?: boolean
  display?: string
  description?: string
  detail?: string
  instructions?: string
  tier?: string
  repo?: string
  sha?: string
  phase?: string
  target_profile?: string
  scan?: { status: string; summary: string }
  launch?: { kind: string; target: string; cwd?: string; env?: string[] }
  connect_url?: string
  required_env?: { name: string; required: boolean; secret: boolean; default: string; prompt?: string }[]
  enabled?: boolean
  missing_env?: string[]
  server_errors?: { name: string; error: string }[]
}

export type ChatConnectionSnapshot = {
  op_id: string
  seq: number
  deadline_at: number
  settled?: boolean
  settled_by?: string
  targets: ChatConnectionTarget[]
  tool_call_id?: string
  display?: { suggested: string[] }
}

export type ChatConnectionAnswer = {
  targets?: { name: string; status: 'approved' | 'skipped'; env?: Record<string, string> }[]
  settled_by?: 'continue'
  said?: string
}

export type ChatConnectionCommand = { op_id: string } & (
  | { action: 'respond'; answer: ChatConnectionAnswer }
  | { action: 'status' | 'wake' }
  | { action: 'open' | 'retry'; name: string }
)

export type ChatConnectionResult = { status: 'ok'; settled?: boolean } | ChatConnectionSnapshot
