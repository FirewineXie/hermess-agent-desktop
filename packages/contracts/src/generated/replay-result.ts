// Generated from schema/replay-result.schema.json. Run pnpm generate:contracts.
import type { GatewayRequest } from './gateway-request'
export type ReplayResult = {
  events: Array<{
    type: string
    session_id?: string
    seq?: number
    payload?: Record<string, unknown>
  }>
  latest_seq: number
  count: number
  epoch: string
  truncated: boolean
  open_requests: Array<GatewayRequest>
}
