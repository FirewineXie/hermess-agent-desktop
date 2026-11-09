import React from 'react'
import type { SessionScope, SubagentRoster, SubagentRow, SubagentTail } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'

export function useSubagents(profile: string, sessionId: string, active: boolean, language: 'zh-CN' | 'en-US') {
  const { chat, events } = useDesktop()
  const [roster, setRoster] = React.useState<SubagentRoster | null>(null)
  const [finished, setFinished] = React.useState<SubagentRow[]>([])
  const [liveActivity, setLiveActivity] = React.useState<Record<string, string>>({})
  const refreshRoster = React.useRef<(() => Promise<void>) | null>(null)
  const rosterRef = React.useRef(roster)
  rosterRef.current = roster
  const [tail, setTail] = React.useState<SubagentTail | null>(null)
  const [selectedId, setSelectedId] = React.useState('')
  const [expanded, setExpanded] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [guidance, setGuidance] = React.useState('')
  const scopeKey = `${profile}\u0000${sessionId}`
  const currentScopeKey = React.useRef(scopeKey)
  currentScopeKey.current = scopeKey
  const scope = React.useMemo<SessionScope | null>(() => profile && sessionId
    ? { kind: 'session', profile, sessionId } : null, [profile, sessionId])

  React.useEffect(() => {
    setRoster(null)
    setFinished([])
    setLiveActivity({})
    setTail(null)
    setSelectedId('')
    setExpanded(false)
    setGuidance('')
    setError('')
    setNotice('')
    setBusy(false)
  }, [profile, sessionId])

  React.useEffect(() => {
    if (!scope) return
    let listening = true
    let unlisten: (() => void) | undefined
    void events.onGatewayEvent(event => {
      if (!listening || event.profile !== profile || event.session_id !== sessionId) return
      if (event.kind === 'subagent.start' || event.kind === 'subagent.spawn_requested') {
        void refreshRoster.current?.()
        return
      }
      const id = event.payload.subagent_id
      if (typeof id !== 'string' || !id) return
      if (event.kind === 'subagent.progress' || event.kind === 'subagent.tool' || event.kind === 'subagent.thinking') {
        const tool = event.payload.tool_name
        const activity = event.kind === 'subagent.thinking' ? (language === 'zh-CN' ? '思考中' : 'Thinking')
          : typeof tool === 'string' ? tool : ''
        if (activity) setLiveActivity(current => current[id] === activity ? current : { ...current, [id]: activity })
        return
      }
      if (event.kind !== 'subagent.complete') return
      setLiveActivity(current => {
        if (!(id in current)) return current
        const next = { ...current }
        delete next[id]
        return next
      })
      const previous = rosterRef.current?.subagents.find(row => row.subagent_id === id)
      const status = typeof event.payload.status === 'string' ? event.payload.status : 'finished'
      setFinished(rows => [{ ...previous, subagent_id: id, status },
        ...rows.filter(row => row.subagent_id !== id)].slice(0, 10))
    }).then(stop => { if (listening) unlisten = stop; else stop() }).catch(() => {})
    return () => { listening = false; unlisten?.() }
  }, [events, profile, sessionId, scope, language])

  React.useEffect(() => {
    if (!scope || !active) return
    let cancelled = false
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      setLoading(true)
      try {
        const next = await chat.subagents(scope)
        if (!cancelled) { setRoster(next); setError('') }
      } catch (cause) {
        if (!cancelled) setError(describeError(cause, language))
      } finally {
        reading = false
        if (!cancelled) setLoading(false)
      }
    }
    refreshRoster.current = refresh
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => { cancelled = true; refreshRoster.current = null; window.clearInterval(timer) }
  }, [chat, scope, active, language])

  React.useEffect(() => {
    if (!scope || !active || !expanded || !selectedId) return
    let cancelled = false
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try {
        const next = await chat.subagentTail(scope, selectedId)
        if (!cancelled) setTail(next)
      } catch (cause) {
        if (!cancelled) setError(describeError(cause, language))
      } finally { reading = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [chat, scope, active, expanded, selectedId, language])

  const select = (id: string) => { setSelectedId(id); setTail(null); setNotice(''); setGuidance('') }
  const steer = async () => {
    if (!scope || !selectedId || !guidance.trim() || busy) return
    const startedFor = scopeKey
    setBusy(true)
    setError('')
    try {
      const result = await chat.steerSubagent(scope, selectedId, guidance.trim())
      if (currentScopeKey.current !== startedFor) return
      setNotice(result.status === 'queued'
        ? language === 'zh-CN' ? '引导已排队，子代理会在下一个检查点读取。' : 'Guidance queued for the next checkpoint.'
        : language === 'zh-CN' ? '子代理未接受引导，请刷新状态。' : 'Subagent did not accept guidance; refresh its status.')
      if (result.status === 'queued') setGuidance('')
    } catch (cause) { if (currentScopeKey.current === startedFor) setError(describeError(cause, language)) }
    finally { if (currentScopeKey.current === startedFor) setBusy(false) }
  }
  const stop = async () => {
    if (!scope || !selectedId || busy) return
    const startedFor = scopeKey
    setBusy(true)
    setError('')
    try {
      const result = await chat.stopSubagent(scope, selectedId)
      if (currentScopeKey.current !== startedFor) return
      setNotice(result.found
        ? language === 'zh-CN' ? '已请求中断，最终状态以任务列表为准。' : 'Interrupt requested; check the roster for final status.'
        : language === 'zh-CN' ? '未找到运行中的子代理，请刷新状态。' : 'No running subagent found; refresh its status.')
    } catch (cause) { if (currentScopeKey.current === startedFor) setError(describeError(cause, language)) }
    finally { if (currentScopeKey.current === startedFor) setBusy(false) }
  }

  return { roster, finished, liveActivity, tail, selectedId, expanded, loading, busy, error, notice, guidance,
    setExpanded, setGuidance, select, steer, stop }
}
