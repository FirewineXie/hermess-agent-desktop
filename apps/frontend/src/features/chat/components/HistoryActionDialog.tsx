import React from 'react'
import type { ChatHistoryMutation, MediaScope } from '@hermess/contracts'
import { useDesktop } from '../../../app/DesktopContext'
import { describeError } from '../../../app/desktopErrors'
import { actionableHistoryRow } from '../timeline'

export type HistorySelection = { operation: 'rewind' | 'branch'; rowId: number; text: string; role: 'user' | 'assistant' }

export default function HistoryActionDialog({ selection, scope, language, onApplied, onClose }: {
  selection: HistorySelection; scope: MediaScope; language: 'zh-CN' | 'en-US'
  onApplied: (sessionId: string, edited?: string) => Promise<boolean>; onClose: () => void
}) {
  const { chat } = useDesktop()
  const zh = language === 'zh-CN'
  const editing = selection.operation === 'rewind'
  const dialog = React.useRef<HTMLDialogElement>(null)
  const alive = React.useRef(true)
  const [text, setText] = React.useState(selection.text)
  const [change, setChange] = React.useState<ChatHistoryMutation | null>(null)
  const [committed, setCommitted] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [later, setLater] = React.useState(0)

  React.useEffect(() => {
    alive.current = true
    const node = dialog.current!
    node.showModal()
    return () => { alive.current = false; node.close() }
  }, [])

  React.useEffect(() => {
    let active = true
    void chat.resumeSession(scope).then(snapshot => {
      if (!active) return
      const index = snapshot.messages.findIndex(row => actionableHistoryRow(row) === selection.rowId && row.role === selection.role)
      if (snapshot.running || index < 0 || snapshot.revision == null || snapshot.execution_generation == null) {
        setError(zh ? '这条消息当前无法操作。刷新会话后重试。' : 'This message cannot be changed now. Refresh the chat and try again.')
        return
      }
      setLater(snapshot.messages.slice(index + 1).filter(row => !row.archived && row.role === 'user' && actionableHistoryRow(row)).length)
      setChange({ operation: selection.operation, rowId: selection.rowId, requestId: crypto.randomUUID(),
        revision: snapshot.revision, generation: snapshot.execution_generation })
    }).catch(cause => { if (active) setError(describeError(cause, language)) })
    return () => { active = false }
  }, [chat, scope.profile, scope.sessionId, scope.gatewayEpoch, selection, language, zh])

  async function apply(event: React.FormEvent) {
    event.preventDefault()
    if (!change || busy || (editing && !text.trim())) return
    setBusy(true); setError('')
    try {
      let target = committed
      if (!target) {
        const result = await chat.mutateHistory(scope, change)
        if (!alive.current) return
        target = editing && result.rewound_count ? scope.sessionId : result.branched_session_id || null
        if (!target) throw new Error(zh ? 'Gateway 没有返回会话变更结果。' : 'The Gateway did not return the history change.')
        setCommitted(target)
      }
      const applied = await onApplied(target, editing ? text : undefined)
      if (!alive.current) return
      if (applied) onClose()
      else setError(editing
        ? (zh ? '已回退，重新加载会话后即可发送。' : 'Rewind applied. Reload the conversation to send the edit.')
        : (zh ? `分支已创建，暂未打开。会话 ID ${target}` : `Branch created. It could not be opened yet. Session ID ${target}`))
    } catch (cause) { if (alive.current) setError(describeError(cause, language)) }
    finally { if (alive.current) setBusy(false) }
  }

  const title = editing ? (zh ? '编辑重发' : 'Edit and resend') : (zh ? '从这里分叉' : 'Branch from here')
  return <dialog ref={dialog} className="chat-history-dialog" aria-labelledby="chat-history-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => void apply(event)}>
      <h3 id="chat-history-title">{title}</h3>
      <p>{editing ? (zh ? `将回退这条消息和其后的 ${later} 个用户回合，编辑后的内容会放入输入框。` : `Rewind this message and ${later} later user turns, then review the edited text in the composer.`)
        : (zh ? '新会话保留截至所选消息的记录。' : 'The new chat keeps the transcript through this message.')}</p>
      {editing && <textarea aria-label={title} rows={6} value={text} onChange={event => setText(event.target.value)} disabled={busy} />}
      {!change && !error && <p role="status">{zh ? '正在读取会话记录…' : 'Reading chat history…'}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="chat-history-dialog-actions">
        <button type="button" className="dialog-secondary-action" disabled={busy} onClick={onClose}>{zh ? '关闭' : 'Close'}</button>
        <button type="submit" className="dialog-primary-action" disabled={!change || busy || (editing && !text.trim())}>
          {busy ? (zh ? '处理中…' : 'Working…') : committed ? (zh ? '重新打开' : 'Open again')
            : editing ? (zh ? '回退并填入编辑内容' : 'Rewind and fill composer') : (zh ? '创建并打开分支' : 'Create and open branch')}
        </button>
      </div>
    </form>
  </dialog>
}
