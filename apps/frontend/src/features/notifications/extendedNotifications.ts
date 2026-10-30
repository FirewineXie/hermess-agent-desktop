import type { GatewayEvent } from '@hermess/contracts'
import type { NotificationSession } from './notificationPolicy'

export type ExtendedNotice = {
  kind: 'backgroundDone' | 'credits' | 'plugin'
  text: string
  target: NotificationSession
}

type State = { seq?: number; signature: string | null }
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

// Keys come from the locked runtime producers, never from matching translated
// message text: credits_tracker and gateway/plugin_messages.py.
function noticeKind(key: string): 'credits' | 'plugin' | null {
  if (key.startsWith('credits.')) return 'credits'
  if (key.startsWith('plugin-message:')) return 'plugin'
  return null
}

export class ExtendedNotificationTracker {
  private readonly states = new Map<string, State>()
  private readonly limit: number
  constructor(limit = 1000) { this.limit = limit }

  consume(connectionId: string, event: GatewayEvent): ExtendedNotice | null {
    if (!connectionId || !event.profile || !event.session_id) return null
    const target = { profile: event.profile, sessionId: event.session_id }
    const payload = event.payload
    const scope = JSON.stringify([connectionId, target.profile, target.sessionId])
    const key = text(payload.key)
    let kind: ExtendedNotice['kind']
    let identity: string
    let signature: string | null
    const body = text(payload.text)
    if (event.kind === 'background.complete') {
      const task = text(payload.task_id)
      if (!task || !body) return null
      kind = 'backgroundDone'
      identity = `${scope}:task:${task}`
      // One completed side task has one notification even if replayed with
      // different text or sequence metadata.
      signature = task
    } else if (event.kind === 'notification.show' || event.kind === 'notification.clear') {
      const category = noticeKind(key)
      if (!category) return null
      kind = category
      identity = `${scope}:notice:${key}`
      if (event.kind === 'notification.show' && !body) return null
      signature = event.kind === 'notification.clear' ? null : JSON.stringify([body, text(payload.level)])
    } else return null

    const previous = this.states.get(identity)
    if (event.seq !== undefined && previous?.seq !== undefined && event.seq <= previous.seq) return null
    this.states.delete(identity)
    this.states.set(identity, { seq: event.seq ?? previous?.seq, signature })
    while (this.states.size > this.limit) this.states.delete(this.states.keys().next().value!)
    if (signature === null || previous?.signature === signature) return null
    return { kind, text: body.slice(0, 300), target }
  }
}
