import React from 'react'
import type { DesktopApi, GatewayEvent, SessionScope } from '@hermess/contracts'

export type BackgroundTask = {
  taskId: string
  profile: string
  sessionId: string
  prompt: string
  result: string
  truncated: boolean
  status: 'running' | 'complete' | 'failed' | 'unknown'
}

export function acceptBackgroundTask(items: BackgroundTask[], scope: SessionScope, taskId: string, prompt: string): BackgroundTask[] {
  const existing = items.find(item => item.taskId === taskId && item.profile === scope.profile && item.sessionId === scope.sessionId)
  if (existing) return existing.prompt ? items : items.map(item => item === existing ? { ...item, prompt } : item)
  const accepted: BackgroundTask = { taskId, profile: scope.profile, sessionId: scope.sessionId, prompt, result: '', truncated: false, status: 'running' }
  return [...items, accepted].slice(-50)
}

export function settleBackgroundTask(items: BackgroundTask[], event: GatewayEvent): BackgroundTask[] {
  const taskId = typeof event.payload.task_id === 'string' ? event.payload.task_id : ''
  if (event.kind !== 'background.complete' || !taskId.startsWith('bg_') || !event.profile || !event.session_id) return items
  const raw = typeof event.payload.text === 'string' ? event.payload.text : ''
  const text = Array.from(raw).slice(0, 16 * 1024).join('')
  const failed = text.startsWith('error: ')
  const existing = items.find(item => item.taskId === taskId && item.profile === event.profile && item.sessionId === event.session_id)
  const completed: BackgroundTask = {
    taskId, profile: event.profile, sessionId: event.session_id,
    prompt: existing?.prompt || '', result: failed ? text.slice(7) : text,
    truncated: event.payload.truncated === true || text.length < raw.length, status: failed ? 'failed' : 'complete',
  }
  if (existing && existing.status === completed.status && existing.result === completed.result && existing.truncated === completed.truncated) return items
  return [...items.filter(item => item !== existing), completed].slice(-50)
}

export function useBackgroundTasks(chat: DesktopApi['chat'], diagnostics: DesktopApi['diagnostics'], storagePath: string) {
  const [items, setItems] = React.useState<BackgroundTask[]>([])
  const seen = React.useRef(new Set<string>())

  async function start(scope: SessionScope, prompt: string) {
    const receipt = await chat.startBackgroundTask(scope, prompt)
    if (receipt.status === 'unknown') return { status: 'unknown' as const }
    if (!receipt.task_id?.startsWith('bg_')) throw new Error('Gateway did not return a background task ID')
    setItems(current => acceptBackgroundTask(current, scope, receipt.task_id!, prompt))
    return { status: 'accepted' as const, taskId: receipt.task_id }
  }

  function handleEvent(event: GatewayEvent) {
    if (event.kind !== 'background.complete') return
    setItems(current => settleBackgroundTask(current, event))
    const taskId = typeof event.payload.task_id === 'string' ? event.payload.task_id : ''
    if (!taskId || !event.profile || !event.session_id) return
    const key = `${event.profile}\u0000${event.session_id}\u0000${taskId}`
    if (seen.current.has(key)) return
    seen.current.add(key)
    const outcome = typeof event.payload.text === 'string' && event.payload.text.startsWith('error: ') ? 'failed' : 'completed'
    void diagnostics.recordEvent(storagePath, `background_task_${outcome} profile=${event.profile} session=${event.session_id} task=${taskId}`).catch(() => {})
  }

  function markDisconnected() {
    setItems(current => current.map(item => item.status === 'running' ? { ...item, status: 'unknown' } : item))
  }

  return { start, handleEvent, markDisconnected,
    forSession: (profile: string, sessionId: string) => items.filter(item => item.profile === profile && item.sessionId === sessionId) }
}
