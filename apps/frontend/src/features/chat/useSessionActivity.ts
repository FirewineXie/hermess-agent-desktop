import React from 'react'
import type { GatewayRequest, SessionRow } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'

export type SessionActivity = 'running' | 'completed' | 'failed' | 'approval' | 'suggestion'
type ActivityMap = Record<string, SessionActivity>
type PendingMap = Record<string, Record<string, 'approval' | 'suggestion'>>

const keyFor = (profile: string, id: string) => `${profile}\u0000${id}`

export function useSessionActivity(storagePath: string, connectionId: string | null, selectedProfile: string | null,
  sessions: SessionRow[], otherProfileSessions: Record<string, SessionRow[]>, activeSessionId: string, activeRuntimeId: string,
  activeRequests: GatewayRequest[], chatVisible: boolean, turnBusy: boolean,
  refresh: () => void) {
  const { events } = useDesktop()
  const storageKey = `hermess:session-activity:${storagePath}`
  const [activity, setActivity] = React.useState<ActivityMap>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}') as ActivityMap } catch { return {} }
  })
  const loadedKey = React.useRef(storageKey)
  const [pending, setPending] = React.useState<PendingMap>({})
  const refreshRef = React.useRef(refresh)
  refreshRef.current = refresh
  const sessionRowsRef = React.useRef({ selectedProfile, sessions, otherProfileSessions, activeSessionId, activeRuntimeId })
  sessionRowsRef.current = { selectedProfile, sessions, otherProfileSessions, activeSessionId, activeRuntimeId }
  const resolveKey = (profile: string, runtimeId: string) => {
    const rows = sessionRowsRef.current
    const profileSessions = profile === rows.selectedProfile ? rows.sessions : rows.otherProfileSessions[profile] || []
    const match = profileSessions.find(row => row.session_id === runtimeId || row.id === runtimeId)
    const id = match?.id || (profile === rows.selectedProfile && runtimeId === rows.activeRuntimeId ? rows.activeSessionId : runtimeId)
    return keyFor(profile, id)
  }
  const resolveKeyRef = React.useRef(resolveKey)
  resolveKeyRef.current = resolveKey

  React.useEffect(() => { setPending({}) }, [connectionId])

  React.useEffect(() => {
    if (loadedKey.current !== storageKey) {
      loadedKey.current = storageKey
      try { setActivity(JSON.parse(localStorage.getItem(storageKey) || '{}') as ActivityMap) } catch { setActivity({}) }
      return
    }
    try { localStorage.setItem(storageKey, JSON.stringify(activity)) } catch { /* Status remains visible for this window. */ }
  }, [storageKey, activity])

  React.useEffect(() => {
    if (!connectionId || !turnBusy || !selectedProfile || !activeSessionId) return
    const key = keyFor(selectedProfile, activeSessionId)
    setActivity(current => current[key] === 'running' ? current : { ...current, [key]: 'running' })
  }, [connectionId, turnBusy, selectedProfile, activeSessionId])

  React.useEffect(() => {
    if (!connectionId) return
    let active = true
    let unlisten: (() => void) | undefined
    let unlistenRequest: (() => void) | undefined
    void events.onGatewayEvent(event => {
      if (!active || !event.profile || !event.session_id) return
      const key = resolveKeyRef.current(event.profile, event.session_id)
      if (event.kind === 'message.complete' || event.kind === 'error') {
        setActivity(current => ({ ...current, [key]: event.kind === 'error' || event.payload?.status === 'error' ? 'failed' : 'completed' }))
        setPending(current => { const next = { ...current }; delete next[key]; return next })
      } else if (event.kind === 'message.start' || event.kind === 'message.delta' || event.kind === 'reasoning.delta' || event.kind === 'tool.start') {
        setActivity(current => current[key] === 'running' ? current : { ...current, [key]: 'running' })
      } else if (event.kind === 'request.cancel' && typeof event.payload?.id === 'string') {
        setPending(current => {
          if (!current[key]?.[event.payload.id as string]) return current
          const requests = { ...current[key] }
          delete requests[event.payload.id as string]
          return { ...current, [key]: requests }
        })
      }
    }).then(stop => { if (active) unlisten = stop; else stop() }).catch(() => {})
    void events.onGatewayRequest(request => {
      if (!active || !request.profile) return
      const key = resolveKeyRef.current(request.profile, request.params.session_id)
      setPending(current => ({ ...current, [key]: { ...current[key], [request.id]: request.method === 'approval' ? 'approval' : 'suggestion' } }))
    }).then(stop => { if (active) unlistenRequest = stop; else stop() }).catch(() => {})
    return () => { active = false; unlisten?.(); unlistenRequest?.() }
  }, [connectionId, events])

  React.useEffect(() => {
    if (!connectionId || !selectedProfile || !activeSessionId) return
    const key = keyFor(selectedProfile, activeSessionId)
    const requests = Object.fromEntries(activeRequests.map(request => [request.id, request.method === 'approval' ? 'approval' : 'suggestion'])) as PendingMap[string]
    setPending(current => {
      if (JSON.stringify(current[key] || {}) === JSON.stringify(requests)) return current
      return { ...current, [key]: requests }
    })
  }, [connectionId, selectedProfile, activeSessionId, activeRequests])

  React.useEffect(() => {
    if (!connectionId) return
    const rows = Object.entries(otherProfileSessions)
    if (selectedProfile) rows.push([selectedProfile, sessions])
    setActivity(current => {
      let next = current
      for (const [profile, profileSessions] of rows) for (const session of profileSessions) {
        const key = keyFor(profile, session.id)
        const previous = next[key]
        const viewed = chatVisible && profile === selectedProfile && session.id === activeSessionId
        // The picker may briefly report idle between reasoning and the final reply.
        // Only message.complete or error can settle a running turn.
        const status = viewed && turnBusy ? 'running' : session.running && previous !== 'completed' && previous !== 'failed' && !(viewed && !turnBusy)
          ? 'running' : previous
        if (status && status !== previous) next = { ...next, [key]: status }
      }
      return next
    })
  }, [connectionId, selectedProfile, sessions, otherProfileSessions, activeSessionId, chatVisible, turnBusy])

  React.useEffect(() => {
    if (!connectionId || !Object.values(activity).includes('running')) return
    const timer = window.setInterval(() => refreshRef.current(), 3000)
    return () => window.clearInterval(timer)
  }, [connectionId, Object.values(activity).includes('running')])

  function markViewed(profile: string, id: string) {
    const key = keyFor(profile, id)
    setActivity(current => {
      if (current[key] !== 'completed' && current[key] !== 'failed') return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const displayActivity: ActivityMap = { ...activity }
  for (const [key, requests] of Object.entries(pending)) {
    if (Object.values(requests).includes('approval')) displayActivity[key] = 'approval'
    else if (Object.values(requests).includes('suggestion')) displayActivity[key] = 'suggestion'
  }
  return { activity: displayActivity, markViewed, keyFor }
}
