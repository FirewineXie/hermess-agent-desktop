import type { DesktopApi, SessionScope } from '@hermess/contracts'

export async function runSteerCommand(options: {
  chat: DesktopApi['chat']
  scope: SessionScope | null
  draft: string
  busy: boolean
  hasAttachments: boolean
  inFlight: { current: boolean }
  isCurrent: () => boolean
  language: 'zh-CN' | 'en-US'
  setDraft: (value: string | ((current: string) => string)) => void
  setStatus: (value: string) => void
  onQueued: () => void
  describeError: (cause: unknown) => string
}) {
  const { chat, scope, draft, busy, hasAttachments, inFlight, isCurrent, language, setDraft, setStatus, onQueued, describeError } = options
  const text = draft.slice('/steer'.length).trim()
  if (!scope || !busy || !text || hasAttachments) {
    setStatus(language === 'zh-CN' ? '仅当前回合运行时可用：/steer 要插入的内容' : 'Only available during a running turn: /steer text')
    return false
  }
  if (inFlight.current) return false
  inFlight.current = true
  try {
    const receipt = await chat.steerSession(scope, text)
    if (receipt.status !== 'queued') {
      if (isCurrent()) setStatus(receipt.status === 'unknown' || receipt.delivered !== false
        ? language === 'zh-CN' ? '插入结果未确认；请先查看回合结果再重试，输入已保留。' : 'Delivery is uncertain. Check the turn before retrying; the input is preserved.'
        : language === 'zh-CN' ? '当前回合未接收这条插入消息；输入已保留。' : 'The running turn did not accept this message. The input is preserved.')
      return false
    }
    if (isCurrent()) { setDraft(current => current.trim() === draft ? '' : current); onQueued(); setStatus(language === 'zh-CN' ? '已插入当前运行的回合。' : 'Sent to the running turn.') }
    return true
  } catch (cause) {
    if (isCurrent()) setStatus(describeError(cause))
    return false
  } finally { inFlight.current = false }
}
