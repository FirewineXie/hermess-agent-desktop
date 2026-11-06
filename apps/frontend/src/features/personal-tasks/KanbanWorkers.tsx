import React from 'react'
import { kanbanRequest, withBoard } from './kanbanApi'
import type { KanbanBridge } from './kanbanApi'
import ConfirmActionButton from './ConfirmActionButton'

type Worker = {
  run_id: number
  task_id: string
  task_title: string
  task_assignee?: string | null
  profile?: string | null
  worker_pid?: number | null
  started_at?: number | null
  last_heartbeat_at?: number | null
}
type WorkerList = { workers: Worker[]; count: number; checked_at: number }
type Inspection = {
  run_id: number
  alive: boolean
  pid?: number
  status?: string
  cpu_percent?: number | null
  memory_rss_bytes?: number | null
  num_threads?: number | null
  reason?: string
  error?: string
}

export default function KanbanWorkers({ bridge, board }: { bridge: KanbanBridge; board: string }) {
  const [workers, setWorkers] = React.useState<WorkerList | null>(null)
  const [inspection, setInspection] = React.useState<Inspection | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const refresh = React.useCallback(async () => {
    const result = await kanbanRequest<WorkerList>(bridge, withBoard('/workers/active', board))
    setWorkers(result)
    setInspection(current => current && result.workers.some(worker => worker.run_id === current.run_id) ? current : null)
  }, [bridge, board])

  React.useEffect(() => {
    let live = true
    setWorkers(null); setInspection(null); setError('')
    void kanbanRequest<WorkerList>(bridge, withBoard('/workers/active', board))
      .then(result => { if (live) setWorkers(result) })
      .catch(cause => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [bridge, board])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  const inspect = (runId: number) => void run(async () => {
    const result = await kanbanRequest<Inspection>(bridge, withBoard(`/runs/${runId}/inspect`, board))
    setInspection(result)
  })

  const terminate = (worker: Worker) => {
    void run(async () => {
      await kanbanRequest(bridge, withBoard(`/runs/${worker.run_id}/terminate`, board), 'POST', { reason: 'Stopped from desktop Kanban' })
      await refresh()
    })
  }

  return <section>
    <h3>运行中的 Worker</h3>
    <p className="kanban-native-muted">查看当前看板的运行进程。结束运行会回收对应任务，可从任务详情重新分派。</p>
    <button type="button" disabled={busy} onClick={() => void run(refresh)}>刷新运行列表</button>
    {error && <div className="kanban-native-error" role="alert">{error}</div>}
    {!workers && !error && <p className="kanban-native-muted">正在读取运行列表…</p>}
    {workers && !workers.count && <p className="kanban-native-muted">当前没有运行中的 Worker。</p>}
    {workers?.workers.map(worker => <div className="kanban-native-link" key={worker.run_id}>
      <span><strong>{worker.task_title || worker.task_id}</strong><br />#{worker.run_id} · {worker.profile || worker.task_assignee || '未分派'} · PID {worker.worker_pid ?? '—'}</span>
      <div className="kanban-native-action-row"><button type="button" disabled={busy} onClick={() => inspect(worker.run_id)}>检查</button><ConfirmActionButton disabled={busy} confirmLabel="再次点击结束" onConfirm={() => terminate(worker)}>结束</ConfirmActionButton></div>
    </div>)}
    {inspection && <div role="status" className="kanban-native-log">
      <strong>运行 #{inspection.run_id}：{inspection.alive ? '进程存活' : '进程未运行'}</strong>
      <div>{inspection.reason || inspection.error || [inspection.status, inspection.pid && `PID ${inspection.pid}`, inspection.cpu_percent != null && `CPU ${inspection.cpu_percent}%`, inspection.memory_rss_bytes != null && `内存 ${Math.round(inspection.memory_rss_bytes / 1024 / 1024)} MB`, inspection.num_threads != null && `${inspection.num_threads} 线程`].filter(Boolean).join(' · ')}</div>
    </div>}
  </section>
}
