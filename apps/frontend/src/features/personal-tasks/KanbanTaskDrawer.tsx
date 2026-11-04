import React from 'react'
import { kanbanReopenReview, kanbanRequest, kanbanRequestReview, kanbanTaskMutation, withBoard } from './kanbanApi'
import type { KanbanBridge, KanbanDetail, KanbanHomeChannel, KanbanModelOptions, KanbanWorkflow } from './kanbanApi'
import KanbanRecoveryActions from './KanbanRecoveryActions'
import KanbanModelOverrideField from './KanbanModelOverrideField'
import { EMPTY_TASK_MODEL, taskModelFrom, taskModelPatch } from './kanbanTaskModel'
import type { TaskModelOverride } from './kanbanTaskModel'
import ConfirmActionButton from './ConfirmActionButton'
import { kanbanStatusLabel } from './kanbanLabels'
import KanbanDiagnosticCard from './KanbanDiagnosticCard'
import { presentKanbanEventPayload } from './kanbanEventPresentation'
import { cannotReceiveReview, isReviewSelfAssignment, resolveReviewImplementer, reviewCapabilityLabel } from './reviewCapability'
import type { ReviewCapabilities } from './reviewCapability'
import { inspectKanbanReviewFlow } from './kanbanReviewFlow'

type Props = { bridge: KanbanBridge; board: string; taskId: string; workflow: KanbanWorkflow | null; assignees: string[]; reviewCapabilities: ReviewCapabilities; modelOptions: KanbanModelOptions; refreshSignal?: number; focusComment?: boolean; onClose(): void; onOpenTask(taskId: string, focusComment?: boolean): void; onChanged(): void }

function date(seconds?: number) { return seconds ? new Date(seconds * 1000).toLocaleString('zh-CN') : '—' }

export default function KanbanTaskDrawer({ bridge, board, taskId, workflow, assignees, reviewCapabilities, modelOptions, refreshSignal = 0, focusComment = false, onClose, onOpenTask, onChanged }: Props) {
  const [detail, setDetail] = React.useState<KanbanDetail | null>(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [comment, setComment] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [summary, setSummary] = React.useState('')
  const [blockReason, setBlockReason] = React.useState('')
  const [reviewReason, setReviewReason] = React.useState('')
  const [reviewer, setReviewer] = React.useState('')
  const [linkId, setLinkId] = React.useState('')
  const [linkKind, setLinkKind] = React.useState<'parent' | 'child'>('child')
  const [log, setLog] = React.useState<string | null>(null)
  const [homeChannels, setHomeChannels] = React.useState<KanbanHomeChannel[]>([])
  const [homeError, setHomeError] = React.useState('')
  const [modelOverride, setModelOverride] = React.useState<TaskModelOverride>(EMPTY_TASK_MODEL)
  const [runDetail, setRunDetail] = React.useState<KanbanDetail['runs'][number] | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const commentRef = React.useRef<HTMLTextAreaElement>(null)
  const commentFocusApplied = React.useRef(false)
  const titleDirty = React.useRef(false)
  const bodyDirty = React.useRef(false)
  const modelDirty = React.useRef(false)

  const load = React.useCallback(async () => {
    const result = await kanbanRequest<KanbanDetail>(bridge, withBoard(`/tasks/${encodeURIComponent(taskId)}`, board))
    setDetail(result)
    if (!titleDirty.current) setTitle(result.task.title)
    if (!bodyDirty.current) setBody(result.task.body || '')
    if (!modelDirty.current) setModelOverride(taskModelFrom(result.task))
    try {
      const homes = await kanbanRequest<{ home_channels: KanbanHomeChannel[] }>(bridge, withBoard(`/home-channels?task_id=${encodeURIComponent(taskId)}`, board))
      setHomeChannels(homes.home_channels)
      setHomeError('')
    } catch (cause) {
      setHomeChannels([])
      setHomeError(String(cause))
    }
  }, [bridge, board, taskId])

  React.useEffect(() => {
    titleDirty.current = false
    bodyDirty.current = false
    modelDirty.current = false
    setDetail(null)
    setRunDetail(null)
    setError('')
    setReviewReason('')
    setReviewer('')
    let live = true
    void load().catch(cause => { if (live) setError(String(cause)) })
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load().catch(() => {}) }, 5000)
    return () => { live = false; window.clearInterval(timer) }
  }, [load])

  React.useEffect(() => {
    if (refreshSignal > 0 && document.visibilityState === 'visible') void load().catch(() => {})
  }, [refreshSignal, load])

  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    inputRef.current?.focus()
    return () => document.removeEventListener('keydown', close)
  }, [onClose])

  React.useEffect(() => { commentFocusApplied.current = false }, [taskId, focusComment])
  React.useEffect(() => {
    if (focusComment && detail && !commentFocusApplied.current) {
      commentFocusApplied.current = true
      commentRef.current?.focus()
    }
  }, [detail, focusComment])

  const run = async (action: () => Promise<unknown>, closeAfter = false) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); if (closeAfter) onClose(); else await load(); onChanged() }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const patch = (payload: unknown, savedContent = false, savedModel = false) => run(async () => {
    await kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(taskId)}`, board), 'PATCH', payload)
    if (savedContent) { titleDirty.current = false; bodyDirty.current = false }
    if (savedModel) modelDirty.current = false
  })
  const changeStatus = (status: string) => {
    if (status === 'blocked' && !blockReason.trim()) { setError('请先填写阻塞原因。'); return }
    void patch({ status, summary: summary.trim() || undefined, block_reason: blockReason.trim() || undefined })
  }
  const reopenReview = () => {
    const reason = reviewReason.trim()
    if (!reason) { setError('请先填写需要修改的具体原因。'); return }
    void run(async () => {
      await kanbanReopenReview(bridge, board, taskId, reason)
      setReviewReason('')
    })
  }
  const submitReview = (selectedReviewer: string, isResubmission: boolean) => {
    if (!selectedReviewer) { setError('请选择审核人。'); return }
    if (isReviewSelfAssignment(selectedReviewer, reviewImplementer)) { setError('执行者不能审核自己的任务，请选择其他 Profile。'); return }
    if (isResubmission && !summary.trim()) { setError('请填写本轮修正摘要后再提交审核。'); return }
    void run(async () => {
      await kanbanRequestReview(bridge, board, taskId, selectedReviewer, summary.trim())
      setSummary('')
      setReviewer('')
    })
  }
  const addComment = (event: React.FormEvent) => {
    event.preventDefault()
    if (!comment.trim()) return
    void run(async () => { await kanbanRequest(bridge, withBoard(`/tasks/${encodeURIComponent(taskId)}/comments`, board), 'POST', { body: comment.trim(), author: 'desktop' }); setComment('') })
  }
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true); setError('')
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error('单个附件不能超过 20 MB。')
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
        const response = await bridge.request(withBoard(`/tasks/${encodeURIComponent(taskId)}/attachments`, board), 'POST', undefined,
          { filename: file.name, content_type: file.type || 'application/octet-stream', data_base64: btoa(binary) })
        if (response.status < 200 || response.status >= 300) throw new Error(`附件上传失败：HTTP ${response.status}`)
      }
      await load(); onChanged()
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const download = async (id: number, filename: string) => {
    try {
      const response = await bridge.request(withBoard(`/attachments/${id}`, board), 'GET')
      if (response.status !== 200 || !response.body_base64) throw new Error(`下载失败：HTTP ${response.status}`)
      const bytes = Uint8Array.from(atob(response.body_base64), char => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: response.content_type || 'application/octet-stream' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setError(String(cause)) }
  }

  const task = detail?.task
  const moves = task ? workflow?.manual[task.status] || [] : []
  const reviewFlow = inspectKanbanReviewFlow(detail?.events || [])
  const reviewImplementer = resolveReviewImplementer(reviewFlow.implementer, task?.assignee)
  const selectedReviewer = reviewer || reviewFlow.reviewer || ''
  const reviewerIsImplementer = isReviewSelfAssignment(selectedReviewer, reviewImplementer)
  const reviewerAvailable = assignees.includes(selectedReviewer) && !reviewerIsImplementer && !cannotReceiveReview('review', reviewCapabilities[selectedReviewer])
  const canSubmitReview = moves.includes('review')
  const canReopenReview = task?.status === 'review' && moves.includes('ready')
  const ordinaryMoves = moves.filter(status => status !== 'review' && !(task?.status === 'review' && ['triage', 'todo', 'ready'].includes(status)))
  const openDiagnosticTask = (_id: string, focusComment?: boolean) => {
    if (!focusComment) return
    commentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    commentRef.current?.focus()
  }
  return <div className="kanban-native-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><aside className="kanban-native-panel kanban-native-detail" role="dialog" aria-modal="true" aria-label="任务详情">
    <div className="kanban-native-panel-head"><div><p>{task?.id || taskId}</p><h2>{task?.title || '读取任务中…'}</h2></div><button type="button" onClick={onClose} aria-label="关闭">×</button></div>
    {error && <div className="kanban-native-error" role="alert">{error}</div>}
    {detail && <div className="kanban-native-detail-body">
      <div className="kanban-native-detail-meta"><span className={`kanban-native-status status-${task!.status}`}>{kanbanStatusLabel(task!.status)}</span><span>创建 {date(task!.created_at)}</span><span>负责人 {task!.assignee || '未分派'}</span></div>
      {!!task!.diagnostics?.length && <section><h3>任务诊断 · {task!.diagnostics.length}</h3><div className="kanban-native-diagnostics">{task!.diagnostics.map(item => <KanbanDiagnosticCard key={`${item.kind}:${item.last_seen_at}`} bridge={bridge} board={board} group={{ task_id: taskId, task_title: task!.title, task_status: task!.status, task_assignee: task!.assignee, diagnostics: task!.diagnostics || [] }} diagnostic={item} assignees={assignees} onOpenTask={openDiagnosticTask} onChanged={async () => { await load(); onChanged() }} />)}</div></section>}
      <section><h3>目标与内容</h3><label>标题<input ref={inputRef} value={title} onChange={event => { titleDirty.current = true; setTitle(event.target.value) }} /></label><label>说明<textarea rows={5} value={body} onChange={event => { bodyDirty.current = true; setBody(event.target.value) }} /></label><button type="button" disabled={busy || !title.trim()} onClick={() => void patch({ title: title.trim(), body }, true)}>保存内容</button></section>
      <section><h3>分派与状态</h3><div className="kanban-native-fields"><label>负责人<select value={task!.assignee || ''} onChange={event => void patch({ assignee: event.target.value })}><option value="">未分派</option>{assignees.map(name => <option key={name} value={name} disabled={cannotReceiveReview(task!.status, reviewCapabilities[name])}>{name}{task!.status === 'review' ? ` · ${reviewCapabilityLabel(reviewCapabilities[name])}` : ''}</option>)}</select></label><label>优先级<input type="number" defaultValue={task!.priority || 0} onBlur={event => { const value = Number(event.target.value); if (value !== task!.priority) void patch({ priority: value }) }} /></label></div>
        {task!.status === 'review' && task!.assignee && reviewCapabilities[task!.assignee] !== 'ready' && <p className="kanban-native-review-warning" role="status">当前负责人 {task!.assignee}：{reviewCapabilityLabel(reviewCapabilities[task!.assignee])}。请在 Profile 管理中启用 sdlc-review，或改派给具备自动审核能力的 Profile。</p>}
        {canSubmitReview && <div className="kanban-native-review-flow"><h4>{reviewFlow.returnedForChanges ? '重新提交审核' : '提交审核'}</h4>{reviewFlow.returnedForChanges && <p className="kanban-native-muted">任务已退回给 {reviewFlow.implementer || '执行者'} 修改；提交后将交回原审核人继续审核。</p>}<label>审核人<select value={selectedReviewer} onChange={event => setReviewer(event.target.value)}><option value="">请选择审核人</option>{assignees.map(name => { const selfReview = isReviewSelfAssignment(name, reviewImplementer); return <option key={name} value={name} disabled={selfReview || cannotReceiveReview('review', reviewCapabilities[name])}>{name} · {selfReview ? '任务执行者，不能审核' : reviewCapabilityLabel(reviewCapabilities[name])}</option> })}</select></label>{reviewerIsImplementer && <p className="kanban-native-review-warning" role="status">执行者 {reviewImplementer} 不能审核自己的任务，请选择其他 Profile。</p>}{selectedReviewer && !reviewerIsImplementer && !reviewerAvailable && <p className="kanban-native-review-warning" role="status">所选审核人当前不可用，请选择已存在且具备审核能力的 Profile。</p>}<label>{reviewFlow.returnedForChanges ? '本轮修正摘要' : '交付摘要'}<input value={summary} onChange={event => setSummary(event.target.value)} placeholder={reviewFlow.returnedForChanges ? '说明已修正的内容与验证结果' : '说明交付内容与验证结果'} /></label><button className="kanban-native-primary" type="button" disabled={busy || !reviewerAvailable || (reviewFlow.returnedForChanges && !summary.trim())} onClick={() => submitReview(selectedReviewer, reviewFlow.returnedForChanges)}>{reviewFlow.returnedForChanges ? '重新提交审核' : '提交审核'}</button></div>}
        {!canSubmitReview && <label>完成摘要<input value={summary} onChange={event => setSummary(event.target.value)} placeholder="手动标记完成时填写" /></label>}
        {canReopenReview && <div className="kanban-native-review-flow"><h4>审核结论</h4><p className="kanban-native-muted">审核不通过时填写具体问题。系统会先保存审核意见，再把任务交回原执行者并恢复到待执行。</p><label>需要修改的内容<textarea rows={3} value={reviewReason} onChange={event => setReviewReason(event.target.value)} placeholder="说明问题、期望结果和重新验收标准" /></label><button type="button" disabled={busy || !reviewReason.trim()} onClick={reopenReview}>退回给执行者修改</button></div>}
        <label>阻塞原因<input value={blockReason} onChange={event => setBlockReason(event.target.value)} placeholder="标记需处理时填写" /></label>
        <div className="kanban-native-action-row">{ordinaryMoves.map(status => <button key={status} type="button" disabled={busy} onClick={() => changeStatus(status)}>{task!.status === 'review' && status === 'done' ? '审核通过并完成' : `移至${kanbanStatusLabel(status)}`}</button>)}</div>
        <div className="kanban-native-action-row"><button type="button" disabled={busy || task!.status !== 'triage'} onClick={() => void run(() => kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(taskId)}/decompose`, board), 'POST', {}))}>拆解子任务</button></div>
      </section>
      <section><h3>执行模型</h3><p className="kanban-native-muted">留空时继承负责人 Profile 的模型和推理强度；修改会在下一次调度生效。</p>
        <KanbanModelOverrideField value={modelOverride} options={modelOptions} disabled={busy} onChange={value => { modelDirty.current = true; setModelOverride(value) }} />
        <div className="kanban-native-action-row"><button type="button" disabled={busy || !modelDirty.current} onClick={() => void patch(taskModelPatch(modelOverride), false, true)}>保存执行模型</button><button type="button" disabled={busy} onClick={() => { modelDirty.current = true; setModelOverride(EMPTY_TASK_MODEL) }}>恢复继承</button></div>
      </section>
      <section><h3>执行上下文</h3><dl className="kanban-native-context"><div><dt>创建来源</dt><dd>{task!.created_by || '—'}</dd></div><div><dt>租户</dt><dd>{task!.tenant || '—'}</dd></div><div><dt>工作区</dt><dd>{task!.workspace_kind || 'scratch'}{task!.workspace_path ? ` · ${task!.workspace_path}` : ''}</dd></div><div><dt>分支</dt><dd>{task!.branch_name || '—'}</dd></div><div><dt>技能</dt><dd>{task!.skills?.join('、') || '继承 Profile'}</dd></div><div><dt>目标模式</dt><dd>{task!.goal_mode ? `持续推进${task!.goal_max_turns ? ` · 最多 ${task!.goal_max_turns} 轮` : ''}` : '关闭'}</dd></div><div><dt>Worker PID</dt><dd>{task!.worker_pid || '—'}</dd></div><div><dt>连续失败</dt><dd>{task!.consecutive_failures || 0}</dd></div><div><dt>阻塞类型</dt><dd>{task!.status === 'blocked' ? task!.block_kind || '未分类' : '—'}</dd></div></dl>{task!.last_failure_error && <p className="kanban-native-error">最近失败：{task!.last_failure_error}</p>}</section>
      <section><h3>任务通知</h3><p className="kanban-native-muted">订阅后，任务状态通知会发送到该平台配置的主渠道。</p>
        {homeError && <p className="kanban-native-error" role="alert">主渠道读取失败：{homeError}</p>}
        {homeChannels.map(channel => <label className="kanban-native-check" key={`${channel.platform}:${channel.chat_id}:${channel.thread_id}`}><input type="checkbox" checked={channel.subscribed} disabled={busy} onChange={event => void run(() => kanbanRequest(bridge, withBoard(`/tasks/${encodeURIComponent(taskId)}/home-subscribe/${encodeURIComponent(channel.platform)}`, board), event.target.checked ? 'POST' : 'DELETE', event.target.checked ? {} : undefined))} />{channel.platform} · {channel.name || 'Home'}</label>)}
        {!homeError && !homeChannels.length && <p className="kanban-native-muted">尚未配置任何平台主渠道。</p>}
      </section>
      <KanbanRecoveryActions bridge={bridge} board={board} task={task!} assignees={assignees} busy={busy} run={run} />
      {(task!.latest_summary || task!.result) && <section><h3>成果</h3><p className="kanban-native-pre">{task!.latest_summary || task!.result}</p></section>}
      <section><h3>父子任务</h3>{detail.child_results.map(child => <div className="kanban-native-related" key={child.id}><button type="button" className="kanban-native-related-open" onClick={() => onOpenTask(child.id)}><strong>{child.title}</strong><span>{kanbanStatusLabel(child.status)}</span></button><p>{child.latest_summary || child.result || '尚无成果'}</p></div>)}{!detail.child_results.length && <p className="kanban-native-muted">暂无子任务</p>}
        <form onSubmit={event => { event.preventDefault(); const relatedId = linkId.trim(); if (!relatedId || relatedId === taskId || detail.links.parents.includes(relatedId) || detail.links.children.includes(relatedId)) { setError(relatedId === taskId ? '任务不能关联自身。' : '该父子关系已经存在或任务编号为空。'); return } void run(async () => { await kanbanTaskMutation(bridge, board, withBoard('/links', board), 'POST', linkKind === 'parent' ? { parent_id: relatedId, child_id: taskId } : { parent_id: taskId, child_id: relatedId }); setLinkId('') }) }}><label>关系<select value={linkKind} onChange={event => setLinkKind(event.target.value as 'parent' | 'child')}><option value="child">当前任务的子任务</option><option value="parent">当前任务的父任务</option></select></label><label>已有任务编号<input value={linkId} onChange={event => setLinkId(event.target.value)} placeholder="任务编号" /></label><button type="submit" disabled={busy || !linkId.trim()}>建立关联</button></form>
        {detail.link_tasks.map(link => <div className="kanban-native-link" key={link.id}><button type="button" className="kanban-native-link-open" onClick={() => onOpenTask(link.id)}>{link.title} · {kanbanStatusLabel(link.status)}</button><button type="button" disabled={busy} onClick={() => void run(() => kanbanTaskMutation(bridge, board, withBoard(`/links?parent_id=${encodeURIComponent(detail.links.children.includes(link.id) ? taskId : link.id)}&child_id=${encodeURIComponent(detail.links.children.includes(link.id) ? link.id : taskId)}`, board), 'DELETE'))}>解除关联</button></div>)}
      </section>
      <section><h3>附件</h3><input type="file" multiple disabled={busy} onChange={event => { void upload(event.target.files); event.target.value = '' }} />{detail.attachments.map(file => <div className="kanban-native-link" key={file.id}><button type="button" onClick={() => void download(file.id, file.filename)}>{file.filename} · {Math.round(file.size / 1024)} KB</button><ConfirmActionButton disabled={busy} confirmLabel="再次点击删除" onConfirm={() => void run(() => kanbanRequest(bridge, withBoard(`/attachments/${file.id}`, board), 'DELETE'))}>删除</ConfirmActionButton></div>)}</section>
      <section><h3>评论</h3><form onSubmit={addComment}><textarea ref={commentRef} value={comment} onChange={event => setComment(event.target.value)} rows={3} placeholder="补充任务信息或审查意见" /><button type="submit" disabled={busy || !comment.trim()}>添加评论</button></form>{detail.comments.map(item => <div className="kanban-native-related" key={item.id}><strong>{item.author || '—'}</strong><time>{date(item.created_at)}</time><p>{item.body}</p></div>)}</section>
      <section><h3>运行记录</h3>{detail.runs.map(run => <div className="kanban-native-link" key={run.id}><span>#{run.id} · {run.status} · {run.profile || task!.assignee || '未分派'} · {date(run.started_at || undefined)}</span><button type="button" onClick={() => void kanbanRequest<{ run: KanbanDetail['runs'][number] }>(bridge, withBoard(`/runs/${run.id}`, board)).then(value => setRunDetail(value.run)).catch(cause => setError(String(cause)))}>详情</button></div>)}
        {runDetail && <div className="kanban-native-run-detail"><strong>运行 #{runDetail.id}</strong><dl><div><dt>Profile</dt><dd>{runDetail.profile || '—'}</dd></div><div><dt>状态</dt><dd>{runDetail.status}{runDetail.outcome ? ` · ${runDetail.outcome}` : ''}</dd></div><div><dt>开始</dt><dd>{date(runDetail.started_at || undefined)}</dd></div><div><dt>结束</dt><dd>{date(runDetail.ended_at || undefined)}</dd></div></dl>{runDetail.summary && <p>{runDetail.summary}</p>}{runDetail.error && <p className="kanban-native-error">{runDetail.error}</p>}{runDetail.metadata && <pre className="kanban-native-log">{typeof runDetail.metadata === 'string' ? runDetail.metadata : JSON.stringify(runDetail.metadata, null, 2)}</pre>}</div>}
        <button type="button" onClick={() => void kanbanRequest<{ content: string }>(bridge, withBoard(`/tasks/${encodeURIComponent(taskId)}/log?tail=100000`, board)).then(value => setLog(value.content)).catch(cause => setError(String(cause)))}>查看 Worker 日志</button>{log !== null && <pre className="kanban-native-log">{log || '暂无日志'}</pre>}</section>
      <section><h3>事件时间线</h3><ol className="kanban-native-events">{detail.events.map(event => { const presentation = presentKanbanEventPayload(event.payload); return <li key={event.id}><div className="kanban-native-event-head"><span>{event.kind.replaceAll('_', ' ')}</span><time>{date(event.created_at)}</time></div>{presentation.context && <p>{presentation.context}</p>}{presentation.payload && <details><summary>事件上下文</summary><pre>{presentation.payload}</pre></details>}</li> })}</ol></section>
      <section className="kanban-native-danger"><ConfirmActionButton disabled={busy} confirmLabel="再次点击归档" onConfirm={() => void run(() => kanbanTaskMutation(bridge, board, withBoard('/tasks/bulk', board), 'POST', { ids: [taskId], archive: true }), true)}>归档任务</ConfirmActionButton><ConfirmActionButton disabled={busy} confirmLabel="再次点击永久删除" onConfirm={() => void run(() => kanbanTaskMutation(bridge, board, withBoard(`/tasks/${encodeURIComponent(taskId)}`, board), 'DELETE'), true)}>永久删除</ConfirmActionButton></section>
    </div>}
  </aside></div>
}
