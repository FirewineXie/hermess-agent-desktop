import React from 'react'
import { kanbanRequest, kanbanTaskMutation, withBoard } from './kanbanApi'
import type { KanbanBridge, KanbanTask } from './kanbanApi'
import ConfirmActionButton from './ConfirmActionButton'

type Result = { ok: boolean; reason?: string; new_title?: string }
type Props = {
  bridge: KanbanBridge
  board: string
  task: KanbanTask
  assignees: string[]
  busy: boolean
  run(action: () => Promise<unknown>): Promise<void>
}

export default function KanbanRecoveryActions({ bridge, board, task, assignees, busy, run }: Props) {
  const [profile, setProfile] = React.useState(task.assignee || '')
  const [reason, setReason] = React.useState('')
  const [reclaimFirst, setReclaimFirst] = React.useState(false)
  const [message, setMessage] = React.useState('')

  React.useEffect(() => { setProfile(task.assignee || '') }, [task.id, task.assignee])
  React.useEffect(() => { setReclaimFirst(false) }, [task.id, task.status])
  React.useEffect(() => { setReason(''); setMessage('') }, [task.id])

  const reassign = () => {
    if (task.status === 'running' && !reclaimFirst) return
    void run(async () => {
      await kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(task.id)}/reassign`, board), 'POST', {
        profile, reclaim_first: reclaimFirst, reason: reason.trim() || undefined,
      })
      setMessage(profile ? `已分派给 ${profile}` : '已取消分派')
    })
  }

  const reclaim = () => {
    void run(async () => {
      await kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(task.id)}/reclaim`, board), 'POST', { reason: reason.trim() || undefined })
      setMessage('已结束当前运行，可重新分派或推进任务')
    })
  }

  const specify = () => {
    void run(async () => {
      const result = await kanbanTaskMutation<Result>(bridge, board, withBoard(`/tasks/${encodeURIComponent(task.id)}/specify`, board), 'POST', { author: 'desktop' })
      if (!result.ok) throw new Error(result.reason || '完善任务失败')
      setMessage(result.new_title ? `已完善任务：${result.new_title}` : '已完善任务')
    })
  }

  const estimate = () => {
    void run(async () => {
      const result = await kanbanRequest<{ ok: boolean; reason?: string; est_tokens?: number; complexity?: string; rationale?: string }>(
        bridge, withBoard(`/tasks/${encodeURIComponent(task.id)}/estimate`, board), 'POST')
      if (!result.ok) throw new Error(result.reason || '估算失败')
      setMessage(`${result.complexity || '—'} · 约 ${result.est_tokens ?? 0} tokens${result.rationale ? ` · ${result.rationale}` : ''}`)
    })
  }

  return <section>
    <h3>执行与恢复</h3>
    <p className="kanban-native-muted">运行中的任务需要先结束当前 Worker，才能改派给其他 Profile。</p>
    <label>操作原因<input value={reason} onChange={event => setReason(event.target.value)} placeholder="记录改派或回收原因（可选）" /></label>
    <div className="kanban-native-fields">
      <label>重新分派给<select value={profile} onChange={event => setProfile(event.target.value)}><option value="">未分派</option>{assignees.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {task.status === 'running' && <label className="kanban-native-check"><input type="checkbox" checked={reclaimFirst} onChange={event => setReclaimFirst(event.target.checked)} />先结束当前运行</label>}
    </div>
    <div className="kanban-native-action-row">
      <button type="button" disabled={busy || (task.status === 'running' && !reclaimFirst) || (profile === (task.assignee || '') && !reclaimFirst)} onClick={reassign}>重新分派</button>
      {task.status === 'running' && <ConfirmActionButton disabled={busy} confirmLabel="再次点击结束" onConfirm={reclaim}>结束当前运行</ConfirmActionButton>}
      {task.status === 'triage' && <button type="button" disabled={busy} onClick={specify}>用模型完善任务</button>}
      <button type="button" disabled={busy} onClick={estimate}>估算工作量</button>
    </div>
    {message && <p role="status" className="kanban-native-muted">{message}</p>}
  </section>
}
