import type { SessionScope } from '@hermess/contracts'
import type { useSideQuestions } from './sideQuestions'

export async function runBtwCommand(options: {
  scope: SessionScope | null
  draft: string
  hasAttachments: boolean
  inFlight: { current: boolean }
  isCurrent: () => boolean
  language: 'zh-CN' | 'en-US'
  ask: ReturnType<typeof useSideQuestions>['ask']
  setDraft: (value: string | ((current: string) => string)) => void
  setStatus: (value: string) => void
  describeError: (cause: unknown) => string
}) {
  const { scope, draft, hasAttachments, inFlight, isCurrent, language, ask, setDraft, setStatus, describeError } = options
  const question = draft.slice('/btw'.length).trim()
  if (!scope || !question || hasAttachments) {
    setStatus(language === 'zh-CN' ? '请在当前会话输入 /btw 问题，且不要附带文件。' : 'Use /btw question in a current session without attachments.')
    return false
  }
  if (inFlight.current) return false
  inFlight.current = true
  try {
    const result = await ask(scope, question)
    if (result.status === 'unknown') {
      if (isCurrent()) setStatus(language === 'zh-CN' ? '旁路提问是否已接收尚未确认；请先检查有无结果卡片，输入已保留。' : 'Side question delivery is uncertain. Check for a result card before retrying; input is preserved.')
      return false
    }
    if (isCurrent()) {
      setDraft(current => current.trim() === draft ? '' : current)
      setStatus(language === 'zh-CN' ? '旁路提问已开始，主回合继续运行。' : 'Side question started. The main turn continues.')
    }
    return true
  } catch (cause) {
    if (isCurrent()) setStatus(describeError(cause))
    return false
  } finally { inFlight.current = false }
}
