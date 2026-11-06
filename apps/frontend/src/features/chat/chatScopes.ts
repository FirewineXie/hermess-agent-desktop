import type { ProfileScope, SessionScope } from '@hermess/contracts'

export function requireProfileScope(profile: string | null): ProfileScope {
  if (!profile) throw new Error('No active Profile')
  return { kind: 'profile', profile }
}

export function requireSessionScope(profile: string, id: string): SessionScope {
  if (!profile || !id) throw new Error('Session has no Profile owner')
  return { kind: 'session', profile, sessionId: id }
}
