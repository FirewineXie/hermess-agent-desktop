export type NotificationKind = 'approval' | 'input' | 'turnDone' | 'turnError' | 'backgroundDone' | 'credits' | 'plugin'
export type NotificationSession = { profile: string; sessionId: string }

export function shouldNotify(kind: NotificationKind, backgrounded: boolean, target: NotificationSession | undefined, active: NotificationSession | undefined): boolean {
  const sameSession = Boolean(target && active && target.profile === active.profile && target.sessionId === active.sessionId)
  // Non-blocking notices follow the existing native-notification background
  // rule, but can belong to any known session, not just the selected one.
  if (['backgroundDone', 'credits', 'plugin'].includes(kind)) return backgrounded && Boolean(target)
  if (kind === 'approval' || kind === 'input') return Boolean(target) && (backgrounded || !sameSession)
  return backgrounded && sameSession
}

export function eventNotificationKey(connectionId: string, event: { profile?: string; session_id?: string; seq?: number; kind: string }): string {
  return `${connectionId}\u0000${event.profile || ''}\u0000${event.session_id || ''}\u0000${event.seq ?? ''}\u0000${event.kind}`
}

export function requestNotificationKey(connectionId: string, request: { profile?: string; id: string; method: string; params: { session_id: string } }): string {
  return `${connectionId}\u0000${request.profile || ''}\u0000${request.params.session_id}\u0000${request.id}\u0000${request.method}`
}

export class NotificationDeduper {
  private readonly seen = new Set<string>()
  private readonly limit: number
  constructor(limit = 1000) { this.limit = limit }

  add(key: string): boolean {
    if (this.seen.has(key)) return false
    this.seen.add(key)
    while (this.seen.size > this.limit) this.seen.delete(this.seen.values().next().value!)
    return true
  }
}
