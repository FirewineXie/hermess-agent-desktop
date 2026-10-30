import type { SessionScope } from '@hermess/contracts'
import type { useBackgroundTasks } from './backgroundTasks'

export async function runBgCommand(options: {
  scope: SessionScope | null
  draft: string
  hasAttachments: boolean
  inFlight: { current: boolean }
  isCurrent: () => boolean
  language: 'zh-CN' | 'en-US'
  start: ReturnType<typeof useBackgroundTasks>['start']
  setDraft: (value: string | ((current: string) => string)) => void
  setStatus: (value: string) => void
  onStarted: () => void
  describeError: (cause: unknown) => string
}) {
  const { scope, draft, hasAttachments, inFlight, isCurrent, language, start, setDraft, setStatus, onStarted, describeError } = options
  const prompt = draft.slice('/bg'.length).trim()
  if (!scope) {
    setStatus(language === 'zh-CN' ? '请先发送一条普通消息创建会话，再在该会话中输入 /bg 任务内容。' : 'Send a regular message to create a session first, then enter /bg prompt in that session.')
    return false
  }
  if (!prompt) {
    setStatus(language === 'zh-CN' ? '请在 /bg 后输入任务内容。' : 'Enter a task after /bg.')
    return false
  }
  if (hasAttachments) {
    setStatus(language === 'zh-CN' ? '后台任务暂不支持附件，请移除附件后重试。' : 'Background tasks do not support attachments. Remove them and try again.')
    return false
  }
  if (inFlight.current) return false
  inFlight.current = true
  try {
    const result = await start(scope, prompt)
    if (result.status === 'unknown') {
      if (isCurrent()) setStatus(language === 'zh-CN' ? '后台任务是否已接收尚未确认；请先检查任务结果，输入已保留。' : 'Background task delivery is uncertain. Check for a result before retrying; input is preserved.')
      return false
    }
    if (isCurrent()) {
      setDraft(current => current.trim() === draft ? '' : current)
      setStatus(language === 'zh-CN' ? '后台任务已开始，可在右侧查看结果。' : 'Background task started. View its result on the right.')
      onStarted()
    }
    return true
  } catch (cause) {
    if (isCurrent()) setStatus(describeError(cause))
    return false
  } finally { inFlight.current = false }
}
