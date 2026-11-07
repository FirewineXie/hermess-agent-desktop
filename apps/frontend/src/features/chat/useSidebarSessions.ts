import React from 'react'
import type { SessionRow } from '@hermess/contracts'
import { useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace.ts'

type SessionRows = Record<string, SessionRow[]>
type LoadState = 'loading' | 'ready' | 'error'

/** Keep already displayed lists mounted while their current/other Profile role changes. */
export function mergeSidebarSessions(previous: SessionRows, profile: string | null, sessions: SessionRow[],
  state: LoadState, others: SessionRows): SessionRows {
  const next = { ...previous, ...others }
  if (profile && (state === 'ready' || sessions.length > 0)) next[profile] = sessions
  return next
}

export function useSidebarSessions(epoch: string | null | undefined, profile: string | null,
  sessions: SessionRow[], state: LoadState, others: SessionRows): SessionRows {
  const [cached, setCached] = useProfileState<SessionRows>(workspaceKey(epoch, 'sidebar'), {}, 'sidebar:session-lists')
  React.useEffect(() => {
    setCached(previous => mergeSidebarSessions(previous, profile, sessions, state, others))
  }, [epoch, profile, sessions, state, others])
  return mergeSidebarSessions(cached, profile, sessions, state, others)
}
