import React from 'react'
import { kanbanTaskMutation, withBoard } from './kanbanApi'
import type { KanbanBridge, KanbanDiagnostic, KanbanDiagnosticGroup } from './kanbanApi'
import { diagnosticDocsUrl, diagnosticMutation } from './kanbanDiagnosticModel'

type Props = {
  bridge: KanbanBridge
  board: string
  group: KanbanDiagnosticGroup
  diagnostic: KanbanDiagnostic
  assignees: string[]
  onOpenTask(id: string, focusComment?: boolean): void
  onChanged(): Promise<void>
}

function valueText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join('、')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '')
}

export default function KanbanDiagnosticCard({ bridge, board, group, diagnostic, assignees, onOpenTask, onChanged }: Props) {
  const [profile, setProfile] = React.useState(group.task_assignee || '')
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState('')
  const [copied, setCopied] = React.useState('')
  const hasReassign = diagnostic.actions.some(action => action.kind === 'reassign')

  const execute = async (action: KanbanDiagnostic['actions'][number]) => {
    if (busy) return
    setError(''); setMessage('')
    if (action.kind === 'cli_hint') {
      try {
        await navigator.clipboard.writeText(String(action.payload?.command || action.label))
        setCopied(action.label); window.setTimeout(() => setCopied(''), 2000)
      } catch (cause) { setError(cause instanceof Error ? cause.message : '复制失败') }
      return
    }
    if (action.kind === 'comment') { onOpenTask(group.task_id, true); return }
    const mutation = diagnosticMutation(group.task_id, diagnostic.kind, action, profile)
    if (!mutation) {
      if (action.kind === 'reassign') setError('请先选择 Profile。')
      return
    }
    setBusy(true)
    try {
      await kanbanTaskMutation(bridge, board, withBoard(mutation.path, board), mutation.method, mutation.body)
      setMessage(action.kind === 'reclaim' ? '已结束异常运行，任务已回到待执行。' : action.kind === 'unblock' ? '已解除阻塞。' : `已重新分派给 ${profile}。`)
      await onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '处理失败') }
    finally { setBusy(false) }
  }

  return <div className={`severity-${diagnostic.severity}`}>
    <p><strong>{diagnostic.severity.toUpperCase()} · {diagnostic.title}</strong>{diagnostic.count > 1 ? ` · ${diagnostic.count} 次` : ''}</p>
    <p>{diagnostic.detail}</p>
    {diagnostic.data && Object.keys(diagnostic.data).length > 0 && <dl className="kanban-native-diagnostic-data">{Object.entries(diagnostic.data).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{valueText(value)}</dd></div>)}</dl>}
    {hasReassign && <label>重新分派给<select value={profile} disabled={busy} onChange={event => setProfile(event.target.value)}><option value="">选择 Profile</option>{assignees.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
    <div className="kanban-native-action-row">{diagnostic.actions.map((action, index) => {
      const docs = diagnosticDocsUrl(action)
      const label = `${action.suggested ? '建议：' : ''}${copied === action.label ? '已复制' : action.label}`
      if (docs) return <a key={`${action.kind}:${index}`} href={docs} target="_blank" rel="noopener noreferrer">{label}</a>
      if (['reclaim', 'reassign', 'unblock', 'comment', 'cli_hint'].includes(action.kind)) return <button type="button" disabled={busy || (action.kind === 'reassign' && !profile)} key={`${action.kind}:${index}`} onClick={() => void execute(action)}>{label}</button>
      return <span className="kanban-native-muted" key={`${action.kind}:${index}`}>{label}</span>
    })}</div>
    {message && <p role="status" className="kanban-native-muted">{message}</p>}
    {error && <p role="alert" className="kanban-native-error">{error}</p>}
  </div>
}
