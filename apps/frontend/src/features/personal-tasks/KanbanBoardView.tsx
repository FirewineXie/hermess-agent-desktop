import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { kanbanRequest, kanbanTaskMutation, withBoard } from './kanbanApi'
import type { BoardMeta, KanbanBoard, KanbanDetail, KanbanEstimate, KanbanModelOptions, KanbanOrchestration, KanbanStats, KanbanTask, KanbanWorkflow } from './kanbanApi'
import KanbanTaskDrawer from './KanbanTaskDrawer'
import KanbanSettings from './KanbanSettings'
import KanbanPinnedBoards from './KanbanPinnedBoards'
import KanbanModelOverrideField from './KanbanModelOverrideField'
import { EMPTY_TASK_MODEL, bulkStatusPatch, failedBulkTaskIds, taskModelCreateFields } from './kanbanTaskModel'
import type { TaskModelOverride } from './kanbanTaskModel'
import { taskCreateOptions } from './kanbanTaskCreate'
import { kanbanStatusLabel } from './kanbanLabels'
import { buildKanbanTaskTree } from './kanbanTree'
import { normalizeReviewCapability, reviewCapabilityLabel } from './reviewCapability'
import type { ReviewCapabilities } from './reviewCapability'
import './kanban-board.css'

const SELECTED_BOARD_KEY = 'hermess:kanban:selected-board'
const statusDescriptions: Record<string, string> = {
  triage: '等待确认任务类型与下一步', todo: '已记录，等待安排', scheduled: '已设定执行时间',
  ready: '条件已齐，等待调度', running: '助理正在执行', blocked: '执行遇阻，需要处理',
  review: '成果待确认或退回修改', done: '任务已完成', archived: '已归档保存',
}

function timestamp(value?: number | null) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

function elapsed(seconds?: number | null) {
  if (!seconds || seconds < 0) return '—'
  if (seconds < 60) return `${Math.floor(seconds)} 秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`
  return `${Math.floor(seconds / 86400)} 天`
}

function byAssignee(tasks: KanbanTask[]) {
  const groups = new Map<string, KanbanTask[]>()
  for (const task of tasks) {
    const profile = task.assignee || '未分派'
    groups.set(profile, [...(groups.get(profile) || []), task])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

export default function KanbanBoardView({ initialTaskId, connectionId = null, storagePath = '' }: { initialTaskId?: string | null; connectionId?: string | null; storagePath?: string } = {}) {
  const { kanbanDashboard: bridge, extensions } = useDesktop()
  const [boards, setBoards] = React.useState<BoardMeta[]>([])
  const [board, setBoard] = React.useState('default')
  const [workflow, setWorkflow] = React.useState<KanbanWorkflow | null>(null)
  const [orchestration, setOrchestration] = React.useState<KanbanOrchestration | null>(null)
  const [modelOptions, setModelOptions] = React.useState<KanbanModelOptions>({ providers: [] })
  const [data, setData] = React.useState<KanbanBoard | null>(null)
  const [stats, setStats] = React.useState<KanbanStats | null>(null)
  const [snapshot, setSnapshot] = React.useState<{ connectionId: string; board: string; cursor: number } | null>(null)
  const [eventVersion, setEventVersion] = React.useState(0)
  const [liveConnected, setLiveConnected] = React.useState(false)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [focusCommentTask, setFocusCommentTask] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [settings, setSettings] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [showEmptyStatuses, setShowEmptyStatuses] = React.useState(false)
  const [assignee, setAssignee] = React.useState('')
  const [tenant, setTenant] = React.useState('')
  const [archived, setArchived] = React.useState(false)
  const [lanesByProfile, setLanesByProfile] = React.useState(true)
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [newAssignee, setNewAssignee] = React.useState('default')
  const [priority, setPriority] = React.useState('0')
  const [skills, setSkills] = React.useState('')
  const [workspaceKind, setWorkspaceKind] = React.useState('scratch')
  const [workspacePath, setWorkspacePath] = React.useState('')
  const [parent, setParent] = React.useState('')
  const [targetStatus, setTargetStatus] = React.useState('ready')
  const [goalMode, setGoalMode] = React.useState(false)
  const [goalMaxTurns, setGoalMaxTurns] = React.useState('')
  const [newModel, setNewModel] = React.useState<TaskModelOverride>(EMPTY_TASK_MODEL)
  const [estimate, setEstimate] = React.useState<KanbanEstimate | null>(null)
  const [estimateBusy, setEstimateBusy] = React.useState(false)
  const [dragged, setDragged] = React.useState<KanbanTask | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = React.useState(false)
  const [bulkStatus, setBulkStatus] = React.useState('')
  const [bulkSummary, setBulkSummary] = React.useState('')
  const [bulkPriority, setBulkPriority] = React.useState('')
  const [bulkReclaim, setBulkReclaim] = React.useState(true)
  const [collapsedStatuses, setCollapsedStatuses] = React.useState<Set<string>>(() => new Set())
  const [childrenByParent, setChildrenByParent] = React.useState<Record<string, string[]>>({})
  const [collapsedTasks, setCollapsedTasks] = React.useState<Set<string>>(() => new Set())
  const [treeWarning, setTreeWarning] = React.useState('')
  const [reviewCapabilities, setReviewCapabilities] = React.useState<ReviewCapabilities>({})
  const creationKey = React.useRef<string | null>(null)
  const boardRef = React.useRef(board)
  const refreshRequest = React.useRef(0)
  const eventCursors = React.useRef(new Map<string, number>())
  boardRef.current = board

  React.useEffect(() => { if (initialTaskId) setSelected(initialTaskId) }, [initialTaskId])
  React.useEffect(() => {
    setCollapsedStatuses(new Set())
    setCollapsedTasks(new Set())
    setChildrenByParent({})
    setTreeWarning('')
  }, [board])

  const assigneeKey = [...(data?.assignees || [])].sort().join('\u0000')
  React.useEffect(() => {
    const profiles = assigneeKey ? assigneeKey.split('\u0000') : []
    if (!profiles.length) {
      setReviewCapabilities({})
      return
    }
    let cancelled = false
    void Promise.allSettled(profiles.map(profile => extensions.request<{ capability?: string }>(
      { kind: 'profile', profile }, 'skills.review-capability',
    ))).then(results => {
      if (cancelled) return
      setReviewCapabilities(Object.fromEntries(profiles.map((profile, index) => {
        const result = results[index]
        return [profile, result.status === 'fulfilled' ? normalizeReviewCapability(result.value.capability) : 'unavailable']
      })))
    })
    return () => { cancelled = true }
  }, [assigneeKey, extensions])

  const refresh = React.useCallback(async () => {
    const requestedBoard = board
    const request = ++refreshRequest.current
    const [result, summary] = await Promise.all([
      kanbanRequest<KanbanBoard>(bridge, withBoard(`/board?include_archived=${archived}`, board)),
      kanbanRequest<KanbanStats>(bridge, withBoard('/stats', board)),
    ])
    if (request !== refreshRequest.current || boardRef.current !== requestedBoard) return
    setData(result); setStats(summary)
    if (connectionId) setSnapshot({ connectionId, board: requestedBoard, cursor: result.latest_event_id })
  }, [bridge, board, archived, connectionId])

  const refreshBoards = React.useCallback(async () => {
    const requestedBoard = board
    const list = await kanbanRequest<{ boards: BoardMeta[] }>(bridge, '/boards')
    if (boardRef.current === requestedBoard) setBoards(list.boards)
  }, [bridge, board])

  React.useEffect(() => {
    let live = true
    void Promise.all([
      kanbanRequest<{ boards: BoardMeta[]; current: string }>(bridge, '/boards'),
      kanbanRequest<KanbanWorkflow>(bridge, '/workflow'),
      kanbanRequest<KanbanOrchestration>(bridge, '/orchestration'),
      kanbanRequest<{ lane_by_profile: boolean; include_archived_by_default: boolean }>(bridge, '/config'),
      kanbanRequest<KanbanModelOptions>(bridge, '/model-options').catch(() => ({ providers: [] })),
    ]).then(([list, steps, assignment, config, models]) => {
      if (!live) return
      setBoards(list.boards)
      let stored = ''
      try { stored = localStorage.getItem(SELECTED_BOARD_KEY) || '' } catch { /* optional preference */ }
      setBoard(list.boards.some(item => item.slug === stored) ? stored : list.current || 'default')
      setWorkflow(steps)
      setOrchestration(assignment)
      setLanesByProfile(config.lane_by_profile)
      setArchived(config.include_archived_by_default)
      setModelOptions(models)
    }).catch(cause => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [bridge])

  React.useEffect(() => {
    let live = true
    setLoading(true)
    const load = async () => {
      try { await refresh(); if (live) setError('') }
      catch (cause) { if (live) setError(String(cause)) }
      finally { if (live) setLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    return () => { live = false; window.clearInterval(timer) }
  }, [refresh])

  React.useEffect(() => {
    const parents = (data?.columns.flatMap(column => column.tasks) || [])
      .filter(task => (task.link_counts?.children || 0) > 0)
    if (!parents.length) { setChildrenByParent({}); setTreeWarning(''); return }
    let active = true
    void Promise.allSettled(parents.map(async task => {
      const detail = await kanbanRequest<KanbanDetail>(bridge, withBoard(`/tasks/${encodeURIComponent(task.id)}`, board))
      return [task.id, detail.links.children] as const
    })).then(results => {
      if (!active) return
      const next: Record<string, string[]> = {}
      let failures = 0
      for (const result of results) {
        if (result.status === 'fulfilled') next[result.value[0]] = result.value[1]
        else failures += 1
      }
      setChildrenByParent(next)
      setTreeWarning(failures ? `有 ${failures} 个父任务的层级读取失败，相关任务暂时按普通任务显示。` : '')
    })
    return () => { active = false }
  }, [bridge, board, data])

  const eventReadyKey = snapshot && connectionId && snapshot.connectionId === connectionId && snapshot.board === board
    ? `${connectionId}:${board}` : ''
  React.useEffect(() => {
    if (!eventReadyKey || !snapshot) { setLiveConnected(false); return }
    let active = true
    let stop: (() => void) | undefined
    let retry: number | undefined
    let refreshing = false
    let pendingRefresh = false
    let connectionSerial = 0
    const cursorKey = eventReadyKey
    let cursor = eventCursors.current.get(cursorKey) ?? snapshot.cursor

    const refreshFromEvent = () => {
      if (refreshing) { pendingRefresh = true; return }
      refreshing = true
      void Promise.allSettled([refresh(), refreshBoards()]).finally(() => {
        refreshing = false
        if (active && pendingRefresh) { pendingRefresh = false; refreshFromEvent() }
      })
    }
    const schedule = () => {
      if (!active || retry !== undefined) return
      retry = window.setTimeout(() => { retry = undefined; void connect() }, 1500)
    }
    const connect = async () => {
      if (!active) return
      const serial = ++connectionSerial
      let ended = false
      try {
        const nextStop = await bridge.events(board, cursor, message => {
          if (!active || serial !== connectionSerial) return
          if (message.kind === 'frame' && typeof message.cursor === 'number') {
            cursor = Math.max(cursor, message.cursor)
            eventCursors.current.set(cursorKey, cursor)
            setLiveConnected(true)
            if (message.events?.length) {
              setEventVersion(value => value + 1)
              refreshFromEvent()
            }
          } else if (message.kind === 'closed') {
            ended = true
            setLiveConnected(false)
            stop?.()
            stop = undefined
            schedule()
          }
        })
        if (!active || serial !== connectionSerial || ended) nextStop()
        else { stop = nextStop; setLiveConnected(true) }
      } catch {
        if (active && serial === connectionSerial) { setLiveConnected(false); schedule() }
      }
    }
    void connect()
    return () => {
      active = false
      connectionSerial += 1
      if (retry !== undefined) window.clearTimeout(retry)
      stop?.()
      setLiveConnected(false)
    }
  }, [bridge, board, eventReadyKey, refresh, refreshBoards])

  React.useEffect(() => {
    if (!data) return
    const present = new Set(data.columns.flatMap(column => column.tasks.map(task => task.id)))
    setSelectedIds(current => {
      const next = new Set([...current].filter(id => present.has(id)))
      return next.size === current.size ? current : next
    })
  }, [data])

  const mutate = async (action: () => Promise<unknown>) => {
    if (busy) return false
    setBusy(true); setError('')
    try { await action(); await refresh(); return true }
    catch (cause) { setError(String(cause)); return false }
    finally { setBusy(false) }
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    const key = creationKey.current ?? crypto.randomUUID()
    creationKey.current = key
    const result = await mutate(async () => {
      const created = await kanbanTaskMutation<{ task: KanbanTask }>(bridge, board, withBoard('/tasks', board), 'POST', {
        title: title.trim(), body: body.trim(), idempotency_key: key,
        ...taskCreateOptions({ assignee: newAssignee, resolvedDefaultAssignee: orchestration?.resolved_default_assignee || 'default', priority, skills, workspaceKind, workspacePath, parent, goalMode, goalMaxTurns, targetStatus }),
        ...taskModelCreateFields(newModel),
      })
      if (created.task.status !== targetStatus) {
        await kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(created.task.id)}`, board), 'PATCH', { status: targetStatus })
      }
    })
    if (result) { creationKey.current = null; setCreating(false); setTitle(''); setBody(''); setNewModel(EMPTY_TASK_MODEL); setEstimate(null) }
  }

  const openCreate = (status = 'ready') => {
    const current = boards.find(item => item.slug === board)
    creationKey.current = null
    setTargetStatus(status)
    setNewAssignee('')
    setPriority('0')
    setSkills('')
    setWorkspaceKind(current?.default_workspace_kind || 'scratch')
    setWorkspacePath('')
    setParent('')
    setGoalMode(false)
    setGoalMaxTurns('')
    setNewModel(EMPTY_TASK_MODEL)
    setEstimate(null)
    setCreating(true)
  }

  const estimateNewTask = async () => {
    if (!title.trim() || estimateBusy) return
    setEstimateBusy(true); setError('')
    try {
      const result = await kanbanRequest<KanbanEstimate>(bridge, '/estimate', 'POST', { title: title.trim(), body: body.trim() || undefined })
      setEstimate(result)
      if (!result.ok) setError(result.reason || '暂时无法估算任务。')
    } catch (cause) { setError(String(cause)) }
    finally { setEstimateBusy(false) }
  }

  const move = async (task: KanbanTask, status: string) => {
    if (task.status === status || !workflow?.manual[task.status]?.includes(status)) return
    await mutate(() => kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(task.id)}`, board), 'PATCH', { status }))
  }

  const selectBoard = (slug: string) => {
    setBoard(slug)
    try { localStorage.setItem(SELECTED_BOARD_KEY, slug) } catch { /* optional preference */ }
    setSelected(null); setSelectedIds(new Set()); setBulkDeleteConfirm(false)
    setCollapsedStatuses(new Set())
  }

  const dispatchReadyTasks = async () => {
    await mutate(() => kanbanRequest(bridge, withBoard('/dispatch', board), 'POST', {}))
  }

  const bulkUpdate = async (patch: Record<string, unknown>) => {
    if (busy || !selectedIds.size) return
    setBusy(true); setError(''); setBulkDeleteConfirm(false)
    try {
      const result = await kanbanTaskMutation<{ results: Array<{ id: string; ok: boolean; error?: string }> }>(
        bridge, board, withBoard('/tasks/bulk', board), 'POST', { ids: [...selectedIds], ...patch })
      const failedIds = failedBulkTaskIds(result.results)
      const firstFailure = result.results.find(item => !item.ok)
      setSelectedIds(new Set(failedIds))
      if (failedIds.length) setError(`${failedIds.length}/${result.results.length} 项操作失败：${firstFailure?.error || '请求被拒绝'}`)
      await refresh()
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  const bulkDelete = async () => {
    if (busy || !selectedIds.size) return
    if (!bulkDeleteConfirm) { setBulkDeleteConfirm(true); return }
    setBusy(true); setError('')
    const ids = [...selectedIds]
    try {
      const results = await Promise.allSettled(ids.map(id => kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(id)}`, board), 'DELETE')))
      const failed = ids.filter((_, index) => results[index].status === 'rejected')
      setSelectedIds(new Set(failed))
      setBulkDeleteConfirm(false)
      if (failed.length) setError(`${failed.length}/${ids.length} 项永久删除失败，失败任务仍保持选中。`)
      await refresh()
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  const visible = (tasks: KanbanTask[]) => tasks.filter(task => {
    const needle = search.trim().toLocaleLowerCase()
    return (!needle || `${task.id} ${task.title} ${task.body || ''}`.toLocaleLowerCase().includes(needle))
      && (!assignee || task.assignee === assignee) && (!tenant || task.tenant === tenant)
  })
  const visibleIds = data?.columns.flatMap(column => visible(column.tasks).map(task => task.id)) || []
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
  const toggleSelection = (ids: string[]) => setSelectedIds(current => {
    const next = new Set(current)
    const remove = ids.length > 0 && ids.every(id => next.has(id))
    for (const id of ids) remove ? next.delete(id) : next.add(id)
    return next
  })
  const activeBoard = boards.find(item => item.slug === board)
  const activeCount = data?.columns.filter(column => column.name !== 'archived').reduce((sum, column) => sum + column.tasks.length, 0) ?? activeBoard?.total ?? 0
  const jumpToStatus = (status: string) => {
    setShowEmptyStatuses(true)
    setCollapsedStatuses(current => { const next = new Set(current); next.delete(status); return next })
    window.requestAnimationFrame(() => document.getElementById(`kanban-branch-${status}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start',
    }))
  }
  const renderCard = (task: KanbanTask, showStatus = false) => {
    const stale = task.status === 'running' && Boolean(task.last_heartbeat_at && Date.now() / 1000 - task.last_heartbeat_at > 120)
    const runStart = task.current_run_started_at || task.started_at
    return <button type="button" className={`kanban-native-card ${selectedIds.has(task.id) ? 'is-selected' : ''} ${stale ? 'is-stale' : ''}`} key={task.id} draggable onDragStart={() => setDragged(task)} onDragEnd={() => setDragged(null)} aria-pressed={selectedIds.has(task.id)} onClick={event => {
      if (event.ctrlKey || event.metaKey) {
        setBulkDeleteConfirm(false)
        setSelectedIds(current => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next })
      } else setSelected(task.id)
    }}>
      <span className="kanban-native-card-id"><span>{task.id}</span><span>{task.priority ? `P${task.priority}` : ''}{task.progress ? ` · ${task.progress.done}/${task.progress.total}` : ''}</span></span>
      <strong>{task.title}</strong>
      {task.latest_summary && <small>{task.latest_summary}</small>}
      {task.status === 'running' && <span className={`kanban-native-card-run ${stale ? 'stale' : ''}`}>{stale ? '心跳超过 2 分钟' : `执行中 · ${elapsed(runStart ? Date.now() / 1000 - runStart : null)}`}</span>}
      {task.status === 'blocked' && task.block_kind && <span className="kanban-native-card-block">阻塞类型：{task.block_kind}{task.block_recurrences ? ` · 已重复 ${task.block_recurrences} 次` : ''}</span>}
      <span className="kanban-native-card-meta"><span>{task.assignee ? `@${task.assignee}` : '未分派'}</span>{showStatus && <span className="kanban-native-tree-status">{kanbanStatusLabel(task.status)}</span>}<span>{task.link_counts?.children ? `子任务 ${task.link_counts.children}` : ''}</span><span>{task.comment_count ? `评论 ${task.comment_count}` : ''}</span>{task.warnings?.count ? <span className="warning">告警 {task.warnings.count}</span> : null}<time>{timestamp(task.created_at)}</time></span>
    </button>
  }
  const renderTaskTree = (tasks: KanbanTask[], includeCrossStatus = false) => buildKanbanTaskTree(
    tasks,
    childrenByParent,
    collapsedTasks,
    includeCrossStatus ? data?.columns.flatMap(column => column.tasks) || tasks : tasks,
  ).map(row => {
    const collapsed = collapsedTasks.has(row.task.id)
    return <div className="kanban-native-tree-row" key={row.task.id} style={{ '--kanban-tree-depth': row.depth } as React.CSSProperties}>
      {row.hasChildren ? <button type="button" className="kanban-native-tree-toggle" aria-expanded={!collapsed} aria-label={`${collapsed ? '展开' : '折叠'}${row.task.title}的子任务`} onClick={() => setCollapsedTasks(current => {
        const next = new Set(current)
        if (next.has(row.task.id)) next.delete(row.task.id); else next.add(row.task.id)
        return next
      })}><span aria-hidden="true">⌄</span></button> : <span className="kanban-native-tree-spacer" aria-hidden="true" />}
      <div className="kanban-native-tree-card">{renderCard(row.task, includeCrossStatus)}</div>
    </div>
  })

  return <main className="kanban-native-page">
    <header className="kanban-native-heading">
      <div><p className="kanban-native-eyebrow">HERMESS · 持续任务</p><h1>持续任务</h1><p>从安排、执行到审核，按状态查看每项任务的下一步。</p></div>
      <button type="button" className="kanban-native-primary" onClick={() => openCreate()}>＋ 新建任务</button>
    </header>
    <div className="kanban-native-toolbar">
      <div className="kanban-native-board-picker">
      <label>看板 <select value={board} onChange={event => selectBoard(event.target.value)}>{boards.map(item => <option key={item.slug} value={item.slug}>{item.name || item.slug}</option>)}</select></label>
      <KanbanPinnedBoards key={storagePath} storagePath={storagePath} boards={boards} current={board} onSelect={selectBoard} onError={setError} />
      <span className="kanban-native-count">{activeCount} 项任务</span>
      </div>
      <div className="kanban-native-toolbar-actions">
      <span className={`kanban-native-live ${liveConnected ? 'connected' : ''}`}><span />{liveConnected ? '实时同步' : '轮询同步'}</span>
      <button type="button" onClick={() => setSettings(true)}>看板与编排设置</button>
      <button type="button" disabled={busy} onClick={() => void dispatchReadyTasks()}>{busy ? '调度中…' : '立即调度'}</button>
      <button type="button" onClick={() => void refresh()}>刷新</button>
      </div>
    </div>
    {stats && <><p className="kanban-native-overview-label">当前看板概览 · 统计不受下方筛选影响</p><section className="kanban-native-stats" aria-label="看板运行概览">
      <button type="button" className="is-attention" onClick={() => jumpToStatus((stats.by_status.blocked || 0) ? 'blocked' : 'review')}><span>需要处理</span><strong>{(stats.by_status.blocked || 0) + (stats.by_status.review || 0)}</strong><small>遇阻 {stats.by_status.blocked || 0} · 待审核 {stats.by_status.review || 0} →</small></button>
      <button type="button" onClick={() => jumpToStatus('running')}><span>正在执行</span><strong>{stats.by_status.running || 0}</strong><small>查看助理当前进展 →</small></button>
      <button type="button" onClick={() => jumpToStatus('ready')}><span>等待推进</span><strong>{['triage', 'todo', 'scheduled', 'ready'].reduce((sum, status) => sum + (stats.by_status[status] || 0), 0)}</strong><small>最久就绪 {elapsed(stats.oldest_ready_age_seconds)} →</small></button>
      <div><span>已完成</span><strong>{stats.by_status.done || 0}</strong><small>{Object.keys(stats.by_assignee).length} 个 Profile 参与</small></div>
    </section></>}
    <div className="kanban-native-filters">
      <input aria-label="搜索任务" placeholder="搜索标题、内容或任务编号" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="按负责人筛选" value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">全部负责人</option>{(data?.assignees || []).map(value => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="按租户筛选" value={tenant} onChange={event => setTenant(event.target.value)}><option value="">全部来源</option>{(data?.tenants || []).map(value => <option key={value} value={value}>{value}</option>)}</select>
      <details className="kanban-native-filter-more"><summary>更多选项{archived ? ' · 含归档' : ''}</summary><div><label className="kanban-native-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />显示已归档</label>
        <label className="kanban-native-check"><input type="checkbox" checked={lanesByProfile} onChange={event => setLanesByProfile(event.target.checked)} />运行中按 Profile 分组</label></div></details>
    </div>
    {error && <div className="kanban-native-error" role="alert">{error}</div>}
    {loading && !data && <div className="kanban-native-loading" role="status">正在读取看板…</div>}
    {data && <><div className="kanban-native-board-intro"><div><h2>任务流程</h2><p>先看有任务的状态；点击任务查看详情，按住 Ctrl 或 ⌘ 点击可多选。</p></div><label className="kanban-native-check"><input type="checkbox" checked={showEmptyStatuses} onChange={event => setShowEmptyStatuses(event.target.checked)} />显示空状态</label></div>
    {!visibleIds.length && <p className="kanban-native-board-empty">当前筛选下没有任务。可调整筛选条件，或显示空状态来新建任务。</p>}
    <div className="kanban-native-tree-board">
      {treeWarning && <p className="kanban-native-tree-warning" role="status">{treeWarning}</p>}
      {data.columns.map(column => {
        const step = workflow?.columns.find(item => item.key === column.name)
        const accepts = Boolean(dragged && step?.drag_target && workflow?.manual[dragged.status]?.includes(column.name))
        const cards = visible(column.tasks)
        if (!showEmptyStatuses && !dragged && !cards.length) return null
        const statusCollapsed = collapsedStatuses.has(column.name)
        const statusLabel = kanbanStatusLabel(column.name) || step?.label
        const toggleStatus = () => setCollapsedStatuses(current => {
          const next = new Set(current)
          if (next.has(column.name)) next.delete(column.name); else next.add(column.name)
          return next
        })
        return <section id={`kanban-branch-${column.name}`} className={`kanban-native-status-branch status-${column.name} ${statusCollapsed ? 'is-collapsed' : ''} ${accepts ? 'drop-ready' : ''}`} key={column.name}
          onDragOver={event => { if (accepts) event.preventDefault() }}
          onDrop={event => { event.preventDefault(); if (dragged && accepts) void move(dragged, column.name); setDragged(null) }}>
          <div className="kanban-native-status-heading">
            <button type="button" className="kanban-native-status-toggle" aria-expanded={!statusCollapsed} aria-controls={`kanban-status-${column.name}`} onClick={toggleStatus}>
              <span className="kanban-native-status-chevron" aria-hidden="true">⌄</span>
              <span className="kanban-native-status-icon" aria-hidden="true">{step?.icon || '◻'}</span>
              <span className="kanban-native-status-title">{statusLabel}</span>
              <span className="kanban-native-status-count">{cards.length}</span>
              <span className="kanban-native-status-description">{statusDescriptions[column.name] || ''}</span>
            </button>
            {!statusCollapsed && !!cards.length && <label className="kanban-native-status-select"><input type="checkbox" checked={cards.every(task => selectedIds.has(task.id))} aria-label={`全选${statusLabel}`} onChange={() => toggleSelection(cards.map(task => task.id))} /><span>全选</span></label>}
            {!statusCollapsed && step?.drag_target !== false && <button type="button" className="kanban-native-status-create" aria-label={`在${statusLabel}新建任务`} onClick={() => openCreate(column.name)}>＋ 新建</button>}
          </div>
          {!statusCollapsed && <div className="kanban-native-status-children" id={`kanban-status-${column.name}`}>
            {column.name === 'review'
              ? renderTaskTree(cards, true)
              : lanesByProfile && column.name === 'running'
              ? byAssignee(cards).map(([profile, tasks]) => <section className="kanban-native-profile-lane" key={profile}><header><strong>{profile}</strong><span>{tasks.length}</span></header>{renderTaskTree(tasks)}</section>)
              : renderTaskTree(cards)}
          </div>}
        </section>
      })}
    </div>
    {!!Object.keys(reviewCapabilities).length && <details className="kanban-native-review-capabilities">
      <summary>审核 Profile 配置 <span>查看各 Profile 的自动审核能力</span></summary>
      <p>待审核任务会强制加载 sdlc-review；禁用该技能的 Profile 仍可执行普通任务，但不能接管自动审核。</p>
      <ul>{Object.entries(reviewCapabilities).map(([profile, capability]) => <li className={`is-${capability}`} key={profile}><span>{profile}</span><strong>{reviewCapabilityLabel(capability)}</strong></li>)}</ul>
    </details>}</>}
    {!!selectedIds.size && <div className="kanban-native-bulk" role="toolbar" aria-label="批量任务操作">
      <strong>已选 {selectedIds.size} 项</strong>
      <button type="button" disabled={busy || !visibleIds.length} onClick={() => toggleSelection(visibleIds)}>{allVisibleSelected ? '取消当前筛选' : '全选当前筛选'}</button>
      <label>移动到<select value="" disabled={busy} onChange={event => { if (event.target.value) { setBulkStatus(event.target.value); setBulkSummary('') } }}><option value="">选择状态</option>{(workflow?.columns || []).filter(item => !['review', 'running', 'scheduled'].includes(item.key)).map(item => <option key={item.key} value={item.key}>{kanbanStatusLabel(item.key)}</option>)}</select></label>
      <label>优先级<input type="number" value={bulkPriority} disabled={busy} onChange={event => setBulkPriority(event.target.value)} /><button type="button" disabled={busy || !bulkPriority.trim()} onClick={() => { const value = Number(bulkPriority); if (Number.isFinite(value)) void bulkUpdate({ priority: value }) }}>应用</button></label>
      <label>改派给<select defaultValue="" disabled={busy} onChange={event => { const next = event.target.value; event.target.value = ''; if (next) void bulkUpdate({ assignee: next === '__none__' ? '' : next, reclaim_first: bulkReclaim }) }}><option value="">选择 Profile</option><option value="__none__">取消分派</option>{(data?.assignees || []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={bulkReclaim} disabled={busy} onChange={event => setBulkReclaim(event.target.checked)} />先回收运行中的任务</label>
      <button type="button" disabled={busy} onClick={() => void bulkUpdate({ archive: true })}>归档</button>
      <button type="button" className={bulkDeleteConfirm ? 'is-danger-confirm' : ''} disabled={busy} onClick={() => void bulkDelete()}>{bulkDeleteConfirm ? '再次点击永久删除' : '永久删除'}</button>
      <button type="button" disabled={busy} onClick={() => { setSelectedIds(new Set()); setBulkDeleteConfirm(false) }} aria-label="清除选择">×</button>
    </div>}
    {bulkStatus && <div className="kanban-native-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setBulkStatus('') }}><div className="kanban-native-bulk-confirm" role="dialog" aria-modal="true" aria-labelledby="kanban-bulk-confirm-title">
      <h2 id="kanban-bulk-confirm-title">确认批量移至{kanbanStatusLabel(bulkStatus)}</h2>
      <p>将修改当前选中的 {selectedIds.size} 个任务。接收方可能释放其 Worker claim，并推进依赖任务。</p>
      {bulkStatus === 'done' && <label>完成摘要<textarea autoFocus rows={4} value={bulkSummary} onChange={event => setBulkSummary(event.target.value)} placeholder="说明已完成的成果与验证结果" /></label>}
      <div><button type="button" onClick={() => setBulkStatus('')}>取消</button><button type="button" className="kanban-native-primary" disabled={busy} onClick={() => { const patch = bulkStatusPatch(bulkStatus, bulkSummary); setBulkStatus(''); void bulkUpdate(patch) }}>确认修改</button></div>
    </div></div>}
    {creating && <div className="kanban-native-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreating(false) }}><form className="kanban-native-panel kanban-native-create" onSubmit={event => void create(event)}>
      <div className="kanban-native-panel-head"><div><p>新建到 {kanbanStatusLabel(targetStatus)}</p><h2>定义目标、执行环境与负责人</h2></div><button type="button" onClick={() => setCreating(false)} aria-label="关闭">×</button></div>
      <label>任务标题<input autoFocus value={title} onChange={event => { creationKey.current = null; setTitle(event.target.value) }} placeholder="希望完成什么？" required /></label>
      <label>目标与完成标准<textarea value={body} onChange={event => { creationKey.current = null; setBody(event.target.value) }} placeholder="说明成果、限制和验收条件" rows={5} /></label>
      <label>初始状态<select value={targetStatus} onChange={event => { creationKey.current = null; setTargetStatus(event.target.value) }}>{(workflow?.columns || []).filter(item => item.drag_target).map(item => <option key={item.key} value={item.key}>{kanbanStatusLabel(item.key)}</option>)}</select></label>
      <label>负责人<select value={newAssignee} onChange={event => { creationKey.current = null; setNewAssignee(event.target.value) }}><option value="">自动分派（{orchestration?.resolved_default_assignee || 'default'}）</option>{(data?.assignees || ['default']).filter(value => value !== orchestration?.resolved_default_assignee).map(value => <option key={value} value={value}>{value}</option>)}<option value="__parked__">暂不分派</option></select></label>
      <label>优先级<input type="number" value={priority} onChange={event => { creationKey.current = null; setPriority(event.target.value) }} /></label>
      <label>工作区<select value={workspaceKind} onChange={event => { creationKey.current = null; setWorkspaceKind(event.target.value) }}><option value="scratch">临时工作区</option><option value="worktree">Git Worktree</option><option value="dir">指定目录</option></select></label>
      {workspaceKind !== 'scratch' && <label>工作目录覆盖<input value={workspacePath} onChange={event => { creationKey.current = null; setWorkspacePath(event.target.value) }} placeholder={activeBoard?.default_workdir || '留空继承看板默认目录'} /><small>{activeBoard?.default_workdir ? `留空使用 ${activeBoard.default_workdir}` : '留空使用看板默认设置'}</small></label>}
      <label>技能<input value={skills} onChange={event => { creationKey.current = null; setSkills(event.target.value) }} placeholder="例如 blogwatcher, github-code-review" /><small>填写 Skill 包名称，不是 web、browser、terminal 等工具集名称。</small></label>
      <label>父任务<select value={parent} onChange={event => { creationKey.current = null; setParent(event.target.value) }}><option value="">无父任务</option>{(data?.columns.flatMap(column => column.tasks) || []).map(task => <option key={task.id} value={task.id}>{task.title || task.id}</option>)}</select></label>
      <KanbanModelOverrideField value={newModel} options={modelOptions} disabled={busy} onChange={value => { creationKey.current = null; setNewModel(value) }} />
      <label className="kanban-native-check"><input type="checkbox" checked={goalMode} onChange={event => { creationKey.current = null; setGoalMode(event.target.checked) }} />按目标持续推进</label>
      {goalMode && <label>最大推进轮次<input type="number" min="1" step="1" value={goalMaxTurns} onChange={event => { creationKey.current = null; setGoalMaxTurns(event.target.value) }} placeholder="留空使用运行时默认值" /><small>达到轮次后任务会停止继续推进，避免无限循环。</small></label>}
      <div className="kanban-native-estimate">{estimate?.ok ? <span>约 {estimate.est_tokens || 0} tokens{estimate.complexity ? ` · ${estimate.complexity}` : ''}{estimate.rationale ? ` · ${estimate.rationale}` : ''}</span> : <span>估算会调用辅助模型，只供规划参考。</span>}<button type="button" disabled={!title.trim() || estimateBusy} onClick={() => void estimateNewTask()}>{estimateBusy ? '估算中…' : estimate?.ok ? '重新估算' : '估算工作量'}</button></div>
      <div className="kanban-native-panel-actions"><button type="button" onClick={() => setCreating(false)}>取消</button><button type="submit" className="kanban-native-primary" disabled={busy || !title.trim()}>{busy ? '创建中…' : `创建到${kanbanStatusLabel(targetStatus)}`}</button></div>
    </form></div>}
    {selected && <KanbanTaskDrawer bridge={bridge} board={board} taskId={selected} workflow={workflow} assignees={data?.assignees || []} reviewCapabilities={reviewCapabilities} modelOptions={modelOptions} refreshSignal={eventVersion} focusComment={focusCommentTask === selected} onClose={() => { setSelected(null); setFocusCommentTask(null) }} onOpenTask={(id, focusComment) => { setSelected(id); setFocusCommentTask(focusComment ? id : null) }} onChanged={() => void refresh()} />}
    {settings && <KanbanSettings bridge={bridge} board={board} boards={boards} onClose={() => setSettings(false)} onOpenTask={(id, focusComment) => { setSelected(id); setFocusCommentTask(focusComment ? id : null) }} onChanged={async nextBoard => { const list = await kanbanRequest<{ boards: BoardMeta[] }>(bridge, '/boards'); setBoards(list.boards); if (nextBoard && nextBoard !== board) selectBoard(nextBoard); else await refresh() }} />}
  </main>
}
