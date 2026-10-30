import React from 'react'
import type { DesktopApi, GatewayEvent, SessionScope } from '@hermess/contracts'

export type SideQuestion = {
  taskId: string
  profile: string
  sessionId: string
  question: string
  answer: string
  status: 'running' | 'complete' | 'failed' | 'unknown'
}

export function acceptSideQuestion(items: SideQuestion[], scope: SessionScope, taskId: string, question: string): SideQuestion[] {
  if (items.some(item => item.taskId === taskId && item.profile === scope.profile && item.sessionId === scope.sessionId)) return items
  const accepted: SideQuestion = { taskId, profile: scope.profile, sessionId: scope.sessionId, question, answer: '', status: 'running' }
  return [...items, accepted].slice(-50)
}

export function settleSideQuestion(items: SideQuestion[], event: GatewayEvent): SideQuestion[] {
  const taskId = typeof event.payload.task_id === 'string' ? event.payload.task_id : ''
  if (event.kind !== 'btw.complete' || !taskId.startsWith('btw_') || !event.profile || !event.session_id) return items
  const question = typeof event.payload.question === 'string' ? event.payload.question : ''
  const text = typeof event.payload.text === 'string' ? event.payload.text.slice(0, 1024) : ''
  const failed = text.startsWith('error: ')
  const answer = failed ? text.slice(7) : text
  const existing = items.find(item => item.taskId === taskId && item.profile === event.profile && item.sessionId === event.session_id)
  const completed: SideQuestion = { taskId, profile: event.profile, sessionId: event.session_id,
    question: question || existing?.question || '', answer, status: failed ? 'failed' : 'complete' }
  if (existing && existing.status === completed.status && existing.answer === completed.answer) return items
  return [...items.filter(item => item !== existing), completed].slice(-50)
}

export function useSideQuestions(chat: DesktopApi['chat'], diagnostics: DesktopApi['diagnostics'], storagePath: string) {
  const [items, setItems] = React.useState<SideQuestion[]>([])
  const seen = React.useRef(new Set<string>())

  async function ask(scope: SessionScope, question: string) {
    const result = await chat.askSideQuestion(scope, question)
    if (result.status === 'unknown') return { status: 'unknown' as const }
    if (!result.task_id?.startsWith('btw_')) throw new Error('Gateway did not return a side question task ID')
    setItems(current => acceptSideQuestion(current, scope, result.task_id!, question))
    return { status: 'accepted' as const, taskId: result.task_id }
  }

  function handleEvent(event: GatewayEvent) {
    if (event.kind !== 'btw.complete') return
    setItems(current => settleSideQuestion(current, event))
    const taskId = typeof event.payload.task_id === 'string' ? event.payload.task_id : ''
    if (!taskId || !event.profile || !event.session_id) return
    const key = `${event.profile}\u0000${event.session_id}\u0000${taskId}`
    if (seen.current.has(key)) return
    seen.current.add(key)
    const outcome = typeof event.payload.text === 'string' && event.payload.text.startsWith('error: ') ? 'failed' : 'completed'
    void diagnostics.recordEvent(storagePath, `side_question_${outcome} profile=${event.profile} session=${event.session_id} task=${taskId}`).catch(() => {})
  }

  function markDisconnected() {
    setItems(current => current.map(item => item.status === 'running' ? { ...item, status: 'unknown' } : item))
  }

  function dismiss(taskId: string, profile: string, sessionId: string) {
    setItems(current => current.filter(item => item.taskId !== taskId || item.profile !== profile || item.sessionId !== sessionId))
  }

  return { ask, handleEvent, markDisconnected, dismiss,
    forSession: (profile: string, sessionId: string) => items.filter(item => item.profile === profile && item.sessionId === sessionId) }
}
