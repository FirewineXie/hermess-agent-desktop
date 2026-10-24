// Generated from schema/gateway-request.schema.json. Run pnpm generate:contracts.
export type GatewayRequest = {
  id: string
  method: "approval" | "clarify"
  params: {
    session_id?: string
    command?: string
    description?: string
    tool_name?: string | null
    choices?: Array<"once" | "session" | "always" | "deny">
    questions?: Array<{
      qid: string
      question: string
      choices?: Array<string> | null
    }>
  } & Record<string, unknown>
}
