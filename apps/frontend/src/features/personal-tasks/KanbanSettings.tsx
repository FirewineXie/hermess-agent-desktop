import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { kanbanRequest, withBoard } from './kanbanApi'
import type { BoardMeta, KanbanBridge, KanbanDiagnostics } from './kanbanApi'
import KanbanWorkers from './KanbanWorkers'
import ConfirmActionButton from './ConfirmActionButton'
import KanbanDiagnosticCard from './KanbanDiagnosticCard'

type Profile = { name: string; model: string; description: string; description_auto: boolean; skill_count: number }
type Project = { id: string; slug: string; name: string; primary_path: string }
type Orchestration = {
  orchestrator_profile: string; default_assignee: string; auto_decompose: boolean; auto_promote_children: boolean
  resolved_orchestrator_profile: string; resolved_default_assignee: string
}
type Props = { bridge: KanbanBridge; board: string; boards: BoardMeta[]; onClose(): void; onOpenTask(id: string, focusComment?: boolean): void; onChanged(nextBoard?: string): Promise<void> }

export default function KanbanSettings({ bridge, board, boards, onClose, onOpenTask, onChanged }: Props) {
  const { nativeFiles } = useDesktop()
  const [tab, setTab] = React.useState<'boards' | 'orchestration' | 'diagnostics'>('boards')
  const [newSlug, setNewSlug] = React.useState('')
  const [newName, setNewName] = React.useState('')
  const [newDescription, setNewDescription] = React.useState('')
  const [newProject, setNewProject] = React.useState('')
  const [newWorkdir, setNewWorkdir] = React.useState('')
  const [boardName, setBoardName] = React.useState(boards.find(item => item.slug === board)?.name || board)
  const [boardDescription, setBoardDescription] = React.useState('')
  const [boardIcon, setBoardIcon] = React.useState('')
  const [boardColor, setBoardColor] = React.useState('')
  const [boardWorkdir, setBoardWorkdir] = React.useState('')
  const [boardProject, setBoardProject] = React.useState('')
  const [projects, setProjects] = React.useState<Project[]>([])
  const [profiles, setProfiles] = React.useState<Profile[]>([])
  const [orchestration, setOrchestration] = React.useState<Orchestration | null>(null)
  const [diagnostics, setDiagnostics] = React.useState<KanbanDiagnostics | null>(null)
  const [description, setDescription] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [transferMessage, setTransferMessage] = React.useState('')
  const [includeAttachments, setIncludeAttachments] = React.useState(true)
  const [includeLogs, setIncludeLogs] = React.useState(false)

  React.useEffect(() => {
    const current = boards.find(item => item.slug === board)
    setBoardName(current?.name || board)
    setBoardDescription(current?.description || '')
    setBoardIcon(current?.icon || '')
    setBoardColor(current?.color || '')
    setBoardWorkdir(current?.default_workdir || '')
    setBoardProject(current?.project_id || '')
  }, [board, boards])

  React.useEffect(() => {
    void Promise.all([
      kanbanRequest<{ profiles: Profile[] }>(bridge, '/profiles'),
      kanbanRequest<Orchestration>(bridge, '/orchestration'),
      kanbanRequest<KanbanDiagnostics>(bridge, withBoard('/diagnostics', board)),
    ]).then(([roster, config, result]) => {
      setProfiles(roster.profiles); setOrchestration(config); setDiagnostics(result)
      setDescription(Object.fromEntries(roster.profiles.map(profile => [profile.name, profile.description])))
    }).catch(cause => setError(String(cause)))
    void kanbanRequest<{ projects: Project[] }>(bridge, '/projects').then(catalog => setProjects(catalog.projects)).catch(() => setProjects([]))
  }, [bridge, board])

  const refreshDiagnostics = async () => {
    const result = await kanbanRequest<KanbanDiagnostics>(bridge, withBoard('/diagnostics', board))
    setDiagnostics(result)
    await onChanged()
  }

  const run = async (action: () => Promise<unknown>, nextBoard?: string) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); await onChanged(nextBoard) }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const createBoard = (event: React.FormEvent) => {
    event.preventDefault()
    const slug = newSlug.trim()
    if (!slug) return
    void run(async () => {
      await kanbanRequest(bridge, '/boards', 'POST', {
        slug, name: newName.trim() || slug, description: newDescription.trim(),
        project_id: newProject || undefined, default_workdir: newWorkdir.trim() || undefined,
      })
      setNewSlug(''); setNewName(''); setNewDescription(''); setNewProject(''); setNewWorkdir('')
    }, slug)
  }
  const saveOrchestration = () => {
    if (!orchestration) return
    void run(async () => {
      const updated = await kanbanRequest<Orchestration>(bridge, '/orchestration', 'PUT', {
        orchestrator_profile: orchestration.orchestrator_profile,
        default_assignee: orchestration.default_assignee,
        auto_decompose: orchestration.auto_decompose,
        auto_promote_children: orchestration.auto_promote_children,
      })
      setOrchestration(updated)
    })
  }

  const exportBoard = async () => {
    if (busy) return
    setError(''); setTransferMessage('')
    try {
      const output = await nativeFiles.save(`${board}.tar.gz`)
      if (!output) return
      setBusy(true)
      const result = await kanbanRequest<{ archive: string; size: number }>(bridge,
        `/boards/${encodeURIComponent(board)}/export`, 'POST',
        { output, attachments: includeAttachments, logs: includeLogs })
      setTransferMessage(`已导出到 ${result.archive}（${result.size} 字节）。`)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  const importBoard = async () => {
    if (busy) return
    setError(''); setTransferMessage('')
    try {
      const selected = await nativeFiles.choose({ directory: false, multiple: false, title: '导入看板归档' })
      const archive = Array.isArray(selected) ? selected[0] : selected
      if (!archive) return
      if (!/\.(?:tar\.gz|tgz)$/i.test(archive)) throw new Error('请选择 .tar.gz 或 .tgz 看板归档。')
      setBusy(true)
      const result = await kanbanRequest<{ board: string; renamed: boolean; tasks_parked: number; warnings: string[] }>(
        bridge, '/boards/import', 'POST', { archive, switch: false })
      await onChanged(result.board)
      setTransferMessage(`已导入为看板 ${result.board}${result.renamed ? '（原名称已占用）' : ''}。${result.tasks_parked ? ` ${result.tasks_parked} 项任务已暂停，需检查后继续。` : ''}${result.warnings.length ? ` 告警：${result.warnings.join('；')}` : ''}`)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  return <div className="kanban-native-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="kanban-native-panel kanban-native-settings" role="dialog" aria-modal="true" aria-label="看板与编排设置">
    <div className="kanban-native-panel-head"><div><p>看板管理</p><h2>看板与编排设置</h2></div><button type="button" onClick={onClose} aria-label="关闭">×</button></div>
    <nav className="kanban-native-tabs" aria-label="设置分类"><button type="button" className={tab === 'boards' ? 'active' : ''} onClick={() => setTab('boards')}>看板</button><button type="button" className={tab === 'orchestration' ? 'active' : ''} onClick={() => setTab('orchestration')}>多 Profile 编排</button><button type="button" className={tab === 'diagnostics' ? 'active' : ''} onClick={() => setTab('diagnostics')}>诊断</button></nav>
    {error && <div className="kanban-native-error" role="alert">{error}</div>}
    <div className="kanban-native-settings-body">
      {tab === 'boards' && <>
        <section><h3>当前看板</h3><p className="kanban-native-muted">{board}</p>
          <label>名称<input value={boardName} onChange={event => setBoardName(event.target.value)} /></label>
          <label>说明<textarea rows={2} value={boardDescription} onChange={event => setBoardDescription(event.target.value)} /></label>
          <div className="kanban-native-fields"><label>图标<input value={boardIcon} onChange={event => setBoardIcon(event.target.value)} placeholder="例如 ◇" /></label><label>颜色<input type="color" value={/^#[0-9a-f]{6}$/i.test(boardColor) ? boardColor : '#4578c8'} onChange={event => setBoardColor(event.target.value)} /></label></div>
          <label>关联项目<select value={boardProject} onChange={event => setBoardProject(event.target.value)}><option value="">不关联项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name || project.slug}</option>)}</select></label>
          <label>默认工作目录<input value={boardWorkdir} onChange={event => setBoardWorkdir(event.target.value)} placeholder="留空使用临时工作区" /></label>
          <p className="kanban-native-muted">工作目录必须是本机已有的绝对路径。关联项目时可留空，使用该项目的主目录。</p>
          <div className="kanban-native-action-row"><button type="button" disabled={busy || !boardName.trim()} onClick={() => void run(() => kanbanRequest(bridge, `/boards/${encodeURIComponent(board)}`, 'PATCH', { name: boardName.trim(), description: boardDescription.trim(), icon: boardIcon.trim(), color: boardColor.trim(), default_workdir: boardWorkdir.trim(), project_id: boardProject }))}>保存看板</button><ConfirmActionButton disabled={busy || board === 'default'} confirmLabel={`再次点击归档 ${board}`} onConfirm={() => void run(() => kanbanRequest(bridge, `/boards/${encodeURIComponent(board)}`, 'DELETE'), 'default')}>归档看板</ConfirmActionButton></div></section>
        <section><h3>已有看板</h3>{boards.map(item => <div className="kanban-native-link" key={item.slug}><span>{item.name || item.slug} · {item.total || 0} 项</span><span>{item.slug}</span></div>)}</section>
        <section><h3>导入与导出</h3><p className="kanban-native-muted">导出当前看板为可迁移归档；导入会创建新看板，已有看板不会被覆盖。工作区目录不包含在归档中。</p>
          <label className="kanban-native-check"><input type="checkbox" checked={includeAttachments} onChange={event => setIncludeAttachments(event.target.checked)} />包含附件</label>
          <label className="kanban-native-check"><input type="checkbox" checked={includeLogs} onChange={event => setIncludeLogs(event.target.checked)} />包含 Worker 日志</label>
          <div className="kanban-native-action-row"><button type="button" disabled={busy} onClick={() => void exportBoard()}>{busy ? '处理中…' : '导出当前看板'}</button><button type="button" disabled={busy} onClick={() => void importBoard()}>{busy ? '处理中…' : '从归档导入新看板'}</button></div>
          {transferMessage && <p role="status" className="kanban-native-muted">{transferMessage}</p>}
        </section>
        <section><h3>新建看板</h3><form onSubmit={createBoard}>
          <label>标识<input value={newSlug} onChange={event => setNewSlug(event.target.value)} placeholder="例如 research" required /></label>
          <label>名称<input value={newName} onChange={event => setNewName(event.target.value)} placeholder="研究项目" /></label>
          <label>说明<textarea rows={2} value={newDescription} onChange={event => setNewDescription(event.target.value)} /></label>
          <label>关联项目<select value={newProject} onChange={event => setNewProject(event.target.value)}><option value="">不关联项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name || project.slug}</option>)}</select></label>
          <label>默认工作目录<input value={newWorkdir} onChange={event => setNewWorkdir(event.target.value)} placeholder="留空使用临时工作区或项目主目录" /></label>
          <button type="submit" className="kanban-native-primary" disabled={busy || !newSlug.trim()}>创建看板</button>
        </form></section>
      </>}
      {tab === 'orchestration' && orchestration && <>
        <section><h3>自动分工</h3><label>任务编排 Profile<select value={orchestration.orchestrator_profile} onChange={event => setOrchestration({ ...orchestration, orchestrator_profile: event.target.value })}><option value="">自动选择（当前 {orchestration.resolved_orchestrator_profile}）</option>{profiles.map(profile => <option key={profile.name} value={profile.name}>{profile.name}</option>)}</select></label><label>默认负责人<select value={orchestration.default_assignee} onChange={event => setOrchestration({ ...orchestration, default_assignee: event.target.value })}><option value="">自动选择（当前 {orchestration.resolved_default_assignee}）</option>{profiles.map(profile => <option key={profile.name} value={profile.name}>{profile.name}</option>)}</select></label><label className="kanban-native-check"><input type="checkbox" checked={orchestration.auto_decompose} onChange={event => setOrchestration({ ...orchestration, auto_decompose: event.target.checked })} />自动拆解待分类任务</label><label className="kanban-native-check"><input type="checkbox" checked={orchestration.auto_promote_children} onChange={event => setOrchestration({ ...orchestration, auto_promote_children: event.target.checked })} />自动推进已满足依赖的子任务</label><button type="button" className="kanban-native-primary" disabled={busy} onClick={saveOrchestration}>保存编排</button></section>
        <section><h3>Profile 职责说明</h3><p className="kanban-native-muted">拆解器会依据说明选择合适的执行 Profile。</p>{profiles.map(profile => <div className="kanban-native-profile" key={profile.name}><strong>{profile.name}</strong><span>{profile.model || '未配置模型'} · {profile.skill_count} 个技能</span><textarea value={description[profile.name] || ''} onChange={event => setDescription({ ...description, [profile.name]: event.target.value })} rows={3} aria-label={`${profile.name} 的职责说明`} /><div className="kanban-native-action-row"><button type="button" disabled={busy} onClick={() => void run(async () => { const result = await kanbanRequest<{ description: string }>(bridge, `/profiles/${encodeURIComponent(profile.name)}`, 'PATCH', { description: description[profile.name] || '' }); setDescription(current => ({ ...current, [profile.name]: result.description })) })}>保存说明</button><button type="button" disabled={busy} onClick={() => void run(async () => { const result = await kanbanRequest<{ ok: boolean; reason?: string; description?: string }>(bridge, `/profiles/${encodeURIComponent(profile.name)}/describe-auto`, 'POST', { overwrite: true }); if (!result.ok) throw new Error(result.reason || '自动生成未完成'); setDescription(current => ({ ...current, [profile.name]: result.description || '' })) })}>自动生成</button></div></div>)}</section>
      </>}
      {tab === 'diagnostics' && <><KanbanWorkers bridge={bridge} board={board} /><section><h3>当前看板诊断{diagnostics ? ` · ${diagnostics.count}` : ''}</h3>
        {!diagnostics && <p className="kanban-native-muted">正在读取诊断信息…</p>}
        {diagnostics && !diagnostics.count && <p className="kanban-native-muted">没有需要处理的任务诊断。</p>}
        {diagnostics?.diagnostics.map(group => <article className="kanban-native-diagnostic" key={group.task_id}>
          <header><div><strong>{group.task_title || group.task_id}</strong><span>{group.task_id} · {group.task_status || '未知状态'} · {group.task_assignee || '未分派'}</span></div><button type="button" onClick={() => { onClose(); onOpenTask(group.task_id) }}>打开任务处理</button></header>
          {group.diagnostics.map(item => <KanbanDiagnosticCard key={`${item.kind}:${item.last_seen_at}`} bridge={bridge} board={board} group={group} diagnostic={item} assignees={profiles.map(profile => profile.name)} onOpenTask={(id, focusComment) => { onClose(); onOpenTask(id, focusComment) }} onChanged={refreshDiagnostics} />)}
        </article>)}
      </section></>}
    </div>
  </section></div>
}
