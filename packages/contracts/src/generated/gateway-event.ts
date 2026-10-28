// Generated from schema/gateway-event.schema.json. Run pnpm generate:contracts.
export type GatewayEvent = {
  kind: string
  connection_id?: string
  profile?: string
  session_id?: string
  seq?: number
  payload: Record<string, unknown>
}
