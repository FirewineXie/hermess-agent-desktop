import type { DesktopApi } from '@hermess/contracts'

export type KanbanBridge = DesktopApi['kanbanDashboard']
export type KanbanTask = {
  id: string
  title: string
  body?: string | null
  status: string
  assignee?: string | null
  tenant?: string | null
  priority?: number
  created_at?: number
  completed_at?: number | null
  started_at?: number | null
  current_run_started_at?: number | null
  last_heartbeat_at?: number | null
  worker_pid?: number | null
  block_kind?: string | null
  block_recurrences?: number
  latest_summary?: string | null
  result?: string | null
  progress?: { done: number; total: number } | null
  link_counts?: { parents: number; children: number }
  comment_count?: number
  warnings?: { count: number; highest_severity?: string | null } | null
  goal_mode?: boolean
  goal_max_turns?: number | null
  skills?: string[] | null
  workspace_kind?: string | null
  workspace_path?: string | null
  branch_name?: string | null
  created_by?: string | null
  consecutive_failures?: number
  last_failure_error?: string | null
  diagnostics?: Array<{
    kind: string; severity: 'critical' | 'error' | 'warning'; title: string; detail: string; count: number; last_seen_at: number
    data?: Record<string, unknown>
    actions: Array<{ kind: string; label: string; suggested?: boolean; payload?: Record<string, unknown> }>
  }> | null
  model_override?: string | null
  provider_override?: string | null
  reasoning_effort?: string | null
}
export type KanbanModelOptions = { providers: Array<{ slug: string; label: string; models: string[] }> }
export type KanbanOrchestration = {
  orchestrator_profile: string; default_assignee: string; auto_decompose: boolean; auto_promote_children: boolean
  resolved_orchestrator_profile: string; resolved_default_assignee: string
}
export type KanbanEstimate = { ok: boolean; reason?: string; est_tokens?: number; complexity?: string | null; rationale?: string | null; model?: string | null }
export type KanbanStats = { by_status: Record<string, number>; by_assignee: Record<string, Record<string, number>>; oldest_ready_age_seconds: number | null; now: number }
export type KanbanHomeChannel = { platform: string; chat_id: string; thread_id: string; name: string; subscribed: boolean }
export type KanbanBoard = { columns: Array<{ name: string; tasks: KanbanTask[] }>; tenants: string[]; assignees: string[]; latest_event_id: number }
export type BoardMeta = {
  slug: string; name?: string | null; description?: string | null; icon?: string | null; color?: string | null
  default_workdir?: string | null; default_workspace_kind?: string; project_id?: string | null; project_name?: string | null
  total?: number; is_current?: boolean
}
export type KanbanWorkflow = { columns: Array<{ key: string; label: string; icon: string; drag_target: boolean }>; manual: Record<string, string[]>; archived: string }
export type KanbanDiagnosticAction = { kind: string; label: string; suggested?: boolean; payload?: Record<string, unknown> }
export type KanbanDiagnostic = {
  kind: string; severity: string; title: string; detail: string; count: number; last_seen_at: number;
  data?: Record<string, unknown>; actions: KanbanDiagnosticAction[]
}
export type KanbanDiagnosticGroup = {
  task_id: string; task_title?: string | null; task_status?: string | null; task_assignee?: string | null;
  diagnostics: KanbanDiagnostic[]
}
export type KanbanDiagnostics = { diagnostics: KanbanDiagnosticGroup[]; count: number }
export type KanbanDetail = {
  task: KanbanTask
  comments: Array<{ id: number; author?: string; body?: string; created_at?: number }>
  events: Array<{ id: number; kind: string; payload?: Record<string, unknown> | string | null; created_at?: number }>
  attachments: Array<{ id: number; filename: string; size: number; content_type?: string }>
  links: { parents: string[]; children: string[] }
  link_tasks: Array<{ id: string; title: string; status: string }>
  child_results: Array<{ id: string; title: string; status: string; latest_summary?: string | null; result?: string | null }>
  runs: Array<{ id: number; profile?: string | null; status: string; outcome?: string | null; summary?: string | null; error?: string | null; metadata?: Record<string, unknown> | string | null; worker_pid?: number | null; started_at?: number | null; ended_at?: number | null }>
}

const ROOT = '/api/plugins/kanban'

export function withBoard(path: string, board: string): string {
  return `${ROOT}${path}${path.includes('?') ? '&' : '?'}board=${encodeURIComponent(board)}`
}

export async function kanbanRequest<T>(bridge: KanbanBridge, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await bridge.request(path.startsWith(ROOT) ? path : `${ROOT}${path}`, method, body)
  if (response.status < 200 || response.status >= 300) {
    const payload = response.body as { detail?: string; error?: string } | undefined
    throw new Error(payload?.detail || payload?.error || `Kanban HTTP ${response.status}`)
  }
  return response.body as T
}

export async function kanbanTaskMutation<T>(bridge: KanbanBridge, _board: string, path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  return kanbanRequest<T>(bridge, path, method, body)
}

/**
 * The locked Dashboard API has no standalone request-changes route. Its human
 * review flow is a durable comment followed by review -> ready; the PATCH is
 * handled by reopen_review_task and restores the recorded implementer.
 */
export async function kanbanReopenReview(
  bridge: KanbanBridge,
  board: string,
  taskId: string,
  reason: string,
): Promise<void> {
  const taskPath = `/tasks/${encodeURIComponent(taskId)}`
  await kanbanRequest(bridge, withBoard(`${taskPath}/comments`, board), 'POST', {
    body: reason,
    author: 'desktop-review',
  })
  await kanbanTaskMutation(bridge, board, withBoard(taskPath, board), 'PATCH', { status: 'ready' })
}

/** Request first review or re-review while preserving implementer provenance. */
export async function kanbanRequestReview(
  bridge: KanbanBridge,
  board: string,
  taskId: string,
  reviewer: string,
  summary?: string,
): Promise<void> {
  await kanbanTaskMutation(
    bridge,
    board,
    withBoard(`/tasks/${encodeURIComponent(taskId)}`, board),
    'PATCH',
    { status: 'review', assignee: reviewer, summary: summary || undefined },
  )
}
