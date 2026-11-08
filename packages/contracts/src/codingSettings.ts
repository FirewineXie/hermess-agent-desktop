export type CodingMcpServer = { id: string; enabled: boolean; transport: 'stdio' | 'http'; command: string; url: string }
export type CodingInstructions = { developer_instructions: string; project_doc_max_bytes: number; project_doc_fallback_filenames: string[] }
export type CodingContextSettings = {
  model_context_window: number | null; model_auto_compact_token_limit: number | null
  tool_output_token_limit: number | null; model_post_turn_compact_threshold_percent: number | null; compact_prompt: string
}
export type CodingSettings = {
  revision: string; config_path?: string; mcp_servers: CodingMcpServer[]; disabled_skills: string[]
  instructions: CodingInstructions; context: CodingContextSettings
}
export type CodingTextFile = { revision: string; content: string; path: string }
export type CodingMcpStatus = { name: string; authStatus: string; tools: Record<string, { name: string; description?: string }>; toolsError?: string | null; runtimeStatus?: unknown }
export type CodingSettingsProbe = { servers: CodingMcpStatus[]; success: boolean; error?: string }
