import type { GatewayEvent, GatewayRequest, ReplayResult } from '@hermess/contracts'

export function mergeRecoveredRequests(
  sessionId: string,
  openRequests: GatewayRequest[],
  bufferedRequests: GatewayRequest[],
  replayEvents: ReplayResult['events'],
  bufferedEvents: GatewayEvent[],
): GatewayRequest[] {
  const cancelled = new Set<string>()
  for (const event of replayEvents) {
    if (event.type === 'request.cancel' && event.session_id === sessionId && typeof event.payload?.id === 'string') {
      cancelled.add(event.payload.id)
    }
  }
  for (const event of bufferedEvents) {
    if (event.kind === 'request.cancel' && event.session_id === sessionId && typeof event.payload.id === 'string') {
      cancelled.add(event.payload.id)
    }
  }

  const requests = new Map<string, GatewayRequest>()
  for (const request of [...openRequests, ...bufferedRequests]) {
    if (request.params.session_id === sessionId && !cancelled.has(request.id) && !requests.has(request.id)) {
      requests.set(request.id, request)
    }
  }
  return [...requests.values()]
}
