import type { DesktopApi, SessionScope } from '@hermess/contracts'
import { appendMessage, type TimelineItem } from './timeline'

export async function runBusyQueueCommand(options: {
  chat: DesktopApi['chat']
  scope: SessionScope | null
  draft: string
  hasAttachments: boolean
  inFlight: { current: boolean }
  isCurrent: () => boolean
  language: 'zh-CN' | 'en-US'
  setDraft: (value: string | ((current: string) => string)) => void
  setStatus: (value: string) => void
  setConversation: (update: (rows: TimelineItem[]) => TimelineItem[]) => void
  onQueued: () => void
  describeError: (cause: unknown) => string
}) {
  const { chat, scope, draft, hasAttachments, inFlight, isCurrent, language, setDraft, setStatus, setConversation, onQueued, describeError } = options
  if (!scope || hasAttachments) {
    setStatus(language === 'zh-CN' ? '当前会话不可用或有附件，请先移除附件。' : 'No current session or attachments are present. Remove attachments first.')
    return false
  }
  if (inFlight.current) return false
  inFlight.current = true
  try {
    const result = await chat.executeCommand(scope, draft)
    if (result.type !== 'exec') throw new Error('Unexpected queue command result')
    if (isCurrent()) {
      setConversation(rows => appendMessage(appendMessage(rows, 'user', draft), 'assistant', result.output || ''))
      setDraft(current => current.trim() === draft ? '' : current)
      onQueued()
      setStatus(result.output || (language === 'zh-CN' ? '队列操作完成。' : 'Queue operation completed.'))
    }
    return true
  } catch (cause) {
    if (isCurrent()) setStatus(describeError(cause))
    return false
  } finally { inFlight.current = false }
}
