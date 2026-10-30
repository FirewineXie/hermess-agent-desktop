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
  if (!scope || !prompt || hasAttachments) {
    setStatus(language === 'zh-CN' ? '请在当前会话输入 /bg 任务内容，且不要附带文件。' : 'Use /bg prompt in a current session without attachments.')
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
