// Generated from schema/gateway-event.schema.json. Run pnpm generate:contracts.
export type GatewayEvent = {
  kind: string
  profile?: string
  session_id?: string
  seq?: number
  payload: Record<string, unknown>
}
