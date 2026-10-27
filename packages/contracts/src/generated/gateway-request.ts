// Generated from schema/gateway-request.schema.json. Run pnpm generate:contracts.
export type GatewayRequest = {
  id: string
  profile?: string
  method: "approval"
  params: {
    session_id: string
    request_id: string
    command?: string
    description?: string
    tool_name?: string | null
    choices?: Array<"once" | "session" | "always" | "deny">
    allow_permanent?: boolean | null
    allow_session?: boolean | null
    smart_denied?: boolean | null
    gateway_session_id?: string | null
  } & Record<string, unknown>
} | {
  id: string
  profile?: string
  method: "clarify"
  params: {
    session_id: string
    questions: Array<{
      qid: string
      question: string
      choices?: Array<string> | null
      multi_select?: boolean
    }>
    answers?: Record<string, string | null> | null
  }
}
