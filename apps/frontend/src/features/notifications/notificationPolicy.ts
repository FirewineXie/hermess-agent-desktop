export type NotificationTarget = { profile: string; sessionId: string }
export type NotificationKind = 'approval' | 'input' | 'turnDone' | 'turnError'

/** Attention requests may interrupt another conversation; completions only follow the active one. */
export function shouldNotify(kind: NotificationKind, backgrounded: boolean, target: NotificationTarget | undefined, active: NotificationTarget | undefined): boolean {
  const sameSession = Boolean(target && active && target.profile === active.profile && target.sessionId === active.sessionId)
  if (kind === 'approval' || kind === 'input') return backgrounded || Boolean(target && !sameSession)
  return backgrounded && sameSession
}
