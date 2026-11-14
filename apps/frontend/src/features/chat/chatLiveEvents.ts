import React from 'react'
import type { DesktopApi, GatewayEvent, SessionScope } from '@hermess/contracts'
import { appendReasoning, updateToolActivity, type TimelineItem } from './timeline'
import type { ChatUsage } from './model'

export function useInitialChatUsage(
  chat: DesktopApi['chat'], scope: SessionScope | null, running: boolean, hasCapacity: boolean,
  workspace: string, sessionRef: React.MutableRefObject<string>, setUsage: (value: ChatUsage) => void,
) {
  const profile = scope?.profile
  const sessionId = scope?.sessionId
  const current = React.useRef({ sessionRef, setUsage })
  current.current = { sessionRef, setUsage }
  React.useEffect(() => {
    if (!profile || !sessionId || !running || hasCapacity) return
    let active = true
    const timer = window.setInterval(() => {
      void chat.usage({ kind: 'session', profile, sessionId }).then(result => {
        if (active && current.current.sessionRef.current === sessionId && (result.context_max ?? result.context_length)) current.current.setUsage(result)
      }).catch(() => {})
    }, 1500)
    return () => { active = false; window.clearInterval(timer) }
  }, [chat, profile, sessionId, running, hasCapacity, workspace])
}

type Callbacks = {
  setConversation: (update: (rows: TimelineItem[]) => TimelineItem[]) => void
  setChatStatus: (text: string) => void
  setChatUsage: (usage: ChatUsage) => void
  refreshSessions: () => void
}

export function consumeChatLiveEvent(event: GatewayEvent, callbacks: Callbacks, zh: boolean): boolean {
  const { kind, payload } = event
  const { setChatStatus, setConversation, setChatUsage, refreshSessions } = callbacks
  switch (kind) {
    case 'tool.progress':
    case 'tool.output_risk':
      setConversation(rows => updateToolActivity(rows, kind, payload))
      break
    case 'tool.generating':
      if (typeof payload.name === 'string') setChatStatus((zh ? '正在生成工具参数 · ' : 'Preparing tool arguments · ') + payload.name)
      break
    case 'status.update':
    case 'agent.print':
      if (typeof payload.text === 'string') setChatStatus(payload.text.slice(0, 400))
      break
    case 'thinking.delta':
      if (typeof payload.text === 'string' && /^[⏳⚠↻⚙]/u.test(payload.text.trim())
        && /waiting on|loading|processing prompt|no (?:output|response)|model returned|rate limited|provider /i.test(payload.text)) {
        setChatStatus(payload.text.slice(0, 400))
      }
      break
    case 'browser.progress':
    case 'notice':
      if (typeof payload.message === 'string') setChatStatus(payload.message.slice(0, 400))
      break
    case 'session.title':
      refreshSessions()
      break
    case 'session.resume_progress':
      if (payload.status === 'loading') setChatStatus(zh ? '正在加载会话历史…' : 'Loading conversation history…')
      else if (payload.status === 'failed') setChatStatus(zh ? '会话历史加载失败' : 'Could not load conversation history')
      else if (payload.status === 'complete') setChatStatus(zh ? '已加载会话历史' : 'Conversation history loaded')
      break
    case 'session.usage':
      if (payload.usage && typeof payload.usage === 'object' &&
        ('context_used' in payload.usage || 'context_max' in payload.usage)) setChatUsage(payload.usage as ChatUsage)
      break
    case 'moa.reference':
      if (typeof payload.text === 'string' && typeof payload.label === 'string') {
        const text = `${payload.label}\n\n${payload.text}`
        setConversation(rows => appendReasoning(rows, text, true, false))
      }
      break
    case 'moa.progress':
      if (typeof payload.refs_done === 'number' && typeof payload.refs_total === 'number') {
        setChatStatus((zh ? 'MoA 参考模型 · ' : 'MoA reference models · ') + `${payload.refs_done}/${payload.refs_total}`)
      }
      break
    case 'moa.aggregating':
    case 'moa.phase':
      if (kind === 'moa.aggregating' || payload.phase === 'aggregator') setChatStatus(zh ? 'MoA 正在汇总' : 'MoA is aggregating')
      break
    default:
      return false
  }
  return true
}
