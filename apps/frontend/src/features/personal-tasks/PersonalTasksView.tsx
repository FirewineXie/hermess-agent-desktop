import React from 'react'
import ConfirmActionButton from './ConfirmActionButton'
import type { PersonalTask, PersonalTaskDetail, ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { taskEventTime, visibleTaskEvents } from './taskProgress'
import './personal-tasks.css'

type Props = { connected: boolean; profiles: ProfilesSnapshot | null; target: { profile: string; id: string } | null; onOpenModelSettings: (profile: string) => void }
const scope = (profile: string) => ({ kind: 'profile' as const, profile })
const statusNames: Record<string, string> = {
  todo: '等待前置任务', scheduled: '等待计划时间', ready: '等待执行', running: '正在运行', blocked: '需要我处理',
  review: '等待审核', done: '已完成', archived: '已归档', triage: '待拆解',
}
const boardLanes = [
  { id: 'queued', zh: '待执行', en: 'Queued', statuses: ['triage', 'todo', 'scheduled', 'ready'] },
  { id: 'running', zh: '进行中', en: 'In progress', statuses: ['running'] },
  { id: 'attention', zh: '待我处理', en: 'Needs attention', statuses: ['blocked', 'review'] },
  { id: 'finished', zh: '已完成', en: 'Finished', statuses: ['done', 'archived'] },
]
const draftKey = (profile: string) => `hermess:personal-task-draft:${profile}`
const readDraft = (profile: string): { title: string; goal: string } => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(profile)) || '{}')
    return { title: typeof saved.title === 'string' ? saved.title : '', goal: typeof saved.goal === 'string' ? saved.goal : '' }
  } catch { return { title: '', goal: '' } }
}

export default function PersonalTasksView({ connected, profiles, target, onOpenModelSettings }: Props) {
  const { personalTasks, models } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [profile, setProfile] = React.useState(target?.profile || profiles?.selected || 'default')
  const [tasks, setTasks] = React.useState<PersonalTask[]>([])
  const [detail, setDetail] = React.useState<PersonalTaskDetail | null>(null)
  const [title, setTitle] = React.useState(() => readDraft(profile).title)
  const [goal, setGoal] = React.useState(() => readDraft(profile).goal)
  const [teamTask, setTeamTask] = React.useState(false)
  const [reply, setReply] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [available, setAvailable] = React.useState(false)
  const [error, setError] = React.useState('')
  const [modelName, setModelName] = React.useState<string | null>(null)
  const [modelError, setModelError] = React.useState('')
  const [modelRead, setModelRead] = React.useState(0)
  const [pane, setPane] = React.useState<'create' | 'detail' | null>(target ? 'detail' : null)
  const titleInput = React.useRef<HTMLInputElement>(null)
  const paneRef = React.useRef<HTMLElement>(null)
  const previousFocus = React.useRef<HTMLElement | null>(null)
  const pendingCreate = React.useRef<string | null>(null)
  const pendingReply = React.useRef<string | null>(null)
  const pendingResume = React.useRef<string | null>(null)
  const selectedId = pane === 'detail' ? detail?.task.id || target?.id || null : null
  const modelReady = Boolean(modelName)
  const progressEvents = detail ? visibleTaskEvents(detail.events, zh) : []
  const closePane = () => { setPane(null); setDetail(null); window.requestAnimationFrame(() => previousFocus.current?.focus()) }
  const openCreate = () => { previousFocus.current = document.activeElement as HTMLElement; setPane('create'); window.requestAnimationFrame(() => titleInput.current?.focus()) }
  const openDetail = (task: PersonalTask) => {
    previousFocus.current = document.activeElement as HTMLElement
    setPane('detail'); setDetail(null); setError('')
    void personalTasks.detail(scope(profile), task.id).then(setDetail).catch(cause => setError(describeError(cause, language)))
  }

  React.useEffect(() => {
    if (!pane) return
    if (pane === 'detail') paneRef.current?.querySelector<HTMLButtonElement>('.personal-tasks-close')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePane()
      if (event.key !== 'Tab' || !paneRef.current) return
      const focusable = [...paneRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
      if (!focusable.length) return
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus() }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pane])

  React.useEffect(() => {
    try { sessionStorage.setItem(draftKey(profile), JSON.stringify({ title, goal })) } catch { /* Optional local draft. */ }
  }, [profile, title, goal])

  React.useEffect(() => {
    if (!connected) { setModelName(null); return }
    let live = true
    setModelName(null)
    setModelError('')
    void models.savedConfig(scope(profile)).then(result => { if (live) setModelName(result.model.trim()) })
      .catch(cause => { if (live) setModelError(describeError(cause, language)) })
    return () => { live = false }
  }, [connected, profile, models, language, modelRead])

  React.useEffect(() => {
    if (target?.profile) { setProfile(target.profile); const draft = readDraft(target.profile); setTitle(draft.title); setGoal(draft.goal); setPane('detail') }
  }, [target?.profile])

  React.useEffect(() => {
    if (!connected) { setAvailable(false); setTasks([]); setDetail(null); return }
    let live = true
    setLoading(true)
    void personalTasks.capabilities(scope(profile)).then(result => {
      if (live) setAvailable(result.version === 1)
      return personalTasks.list(scope(profile))
    }).then(result => { if (live) { setTasks(result.tasks); setError('') } })
      .catch(cause => { if (live) { setAvailable(false); setError(describeError(cause, language)) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [connected, profile, personalTasks, language])

  React.useEffect(() => {
    if (!connected || !available) return
    let live = true
    const refresh = async () => {
      try {
        const list = await personalTasks.list(scope(profile))
        const next = selectedId ? await personalTasks.detail(scope(profile), selectedId) : null
        if (live) { setTasks(list.tasks); if (next) setDetail(next) }
      } catch (cause) { if (live) setError(describeError(cause, language)) }
    }
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { live = false; window.clearInterval(timer) }
  }, [connected, available, profile, selectedId, personalTasks, language])

  React.useEffect(() => {
    if (!target || !available) return
    void personalTasks.detail(scope(target.profile), target.id).then(setDetail)
      .catch(cause => setError(describeError(cause, language)))
  }, [target, available, personalTasks, language])

  const run = async (operation: () => Promise<PersonalTaskDetail>) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await operation()
      setDetail(result)
      setPane('detail')
      const list = await personalTasks.list(scope(profile))
      setTasks(list.tasks)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !goal.trim() || !modelReady) return
    pendingCreate.current ||= crypto.randomUUID()
    await run(async () => {
      const result = await personalTasks.create(scope(profile), pendingCreate.current!, title.trim(), goal.trim(), teamTask)
      pendingCreate.current = null
      setTitle(''); setGoal(''); setTeamTask(false)
      return result
    })
  }
  const decompose = async () => {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const result = await personalTasks.decompose(scope(profile), detail.task.id)
      setDetail(result.detail)
      setTasks((await personalTasks.list(scope(profile))).tasks)
      if (!result.ok) setError(result.reason || (zh ? '任务拆解未完成。' : 'Task decomposition did not complete.'))
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const supplement = async () => {
    if (!detail || !reply.trim()) return
    pendingReply.current ||= crypto.randomUUID()
    await run(async () => {
      const result = await personalTasks.reply(scope(profile), detail.task.id, pendingReply.current!, reply.trim())
      pendingReply.current = null
      setReply('')
      return result
    })
  }
  const resume = async () => {
    if (!detail) return
    pendingResume.current ||= crypto.randomUUID()
    await run(async () => {
      const result = await personalTasks.resume(scope(profile), detail.task.id, pendingResume.current!)
      pendingResume.current = null
      return result
    })
  }
  const archive = async () => {
    if (!detail) return
    await run(() => personalTasks.archive(scope(profile), detail.task.id))
  }

  return <main className="personal-tasks-page">
    <div className="personal-tasks-layout">
      <header className="personal-tasks-heading">
        <div><h1>{zh ? '持续任务' : 'Ongoing tasks'}</h1><p>{zh ? '让 Hermess 在你离开聊天后继续推进任务。' : 'Keep work moving after you leave the chat.'}</p></div>
        {available && <label className="personal-tasks-profile"><span>{zh ? '个人助理' : 'Assistant Profile'}</span><select value={profile} onChange={e => { const next = e.target.value; const draft = readDraft(next); setProfile(next); setTitle(draft.title); setGoal(draft.goal); setDetail(null); setPane(null); pendingCreate.current = null }}>
          {(profiles?.profiles || []).map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}
        </select></label>}
      </header>
      {!connected && <p className="personal-tasks-notice" role="status">{zh ? '请先启动本地后端。' : 'Start the local backend.'}</p>}
      {connected && loading && <p className="personal-tasks-notice" role="status">{zh ? '读取任务中…' : 'Loading tasks…'}</p>}
      {connected && !loading && !available && <p className="personal-tasks-notice" role="status">{zh ? '当前运行时未提供 Kanban 插件接口，请检查运行时和插件状态。' : 'The Kanban plugin API is unavailable. Check the runtime and plugin status.'}</p>}
      {error && <p className="personal-tasks-notice error" role="alert">{error}</p>}
      {available && <>
        <div className="personal-tasks-toolbar"><div><strong>{zh ? '任务看板' : 'Task board'}</strong><span>{zh ? `共 ${tasks.length} 项任务` : `${tasks.length} tasks`}</span></div><button type="button" className="personal-tasks-primary" onClick={openCreate}>{zh ? '＋ 新建任务' : '+ New task'}</button></div>
        <div className="personal-tasks-context"><span className="personal-tasks-context-dot" />{zh ? '任务只在本机 Hermess 运行期间执行；退出应用或电脑休眠时暂停。' : 'Tasks run while Hermess is open on this computer and pause when it closes or sleeps.'}</div>
        <div className="personal-tasks-board" aria-label={zh ? '持续任务看板' : 'Ongoing task board'}>
          {boardLanes.map(lane => {
            const cards = tasks.filter(task => lane.statuses.includes(task.status))
            return <section className={`personal-tasks-lane lane-${lane.id}`} key={lane.id} aria-label={zh ? lane.zh : lane.en}>
              <div className="personal-tasks-lane-heading"><h2>{zh ? lane.zh : lane.en}</h2><span>{cards.length}</span></div>
              <div className="personal-tasks-lane-cards">{cards.length === 0 ? <p className="personal-tasks-lane-empty">{zh ? '暂无任务' : 'No tasks'}</p> : cards.map(task => <button type="button" key={task.id} className={`personal-tasks-card${selectedId === task.id ? ' selected' : ''}`} onClick={() => openDetail(task)}>
                <span className="personal-tasks-card-status">{statusNames[task.status] || task.status}{task.assignee && ` · ${task.assignee}`}</span><strong>{task.title}</strong>{task.progress && <small>{zh ? '子任务' : 'Subtasks'} {task.progress.done}/{task.progress.total}</small>}{task.summary && <small>{task.summary}</small>}<time>{taskEventTime(task.created_at, language)}</time>
              </button>)}</div>
            </section>
          })}
        </div>
        {pane && <div className="personal-tasks-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closePane() }}>
          <section ref={paneRef} className="personal-tasks-content" role="dialog" aria-modal="true" aria-label={pane === 'create' ? (zh ? '新建任务' : 'Create task') : (zh ? '任务详情' : 'Task details')}>
            <button type="button" className="personal-tasks-close" onClick={closePane} aria-label={zh ? '关闭' : 'Close'}>×</button>
            {pane === 'create' ? <form className="personal-tasks-form" onSubmit={event => void create(event)}>
              <div className="personal-tasks-panel-heading"><h2>{zh ? '新建持续任务' : 'New ongoing task'}</h2><p>{zh ? '描述目标、交付内容和需要遵守的条件；任务将使用当前助理已配置的工具。' : 'Describe the outcome, deliverables and constraints. The task uses this Profile’s configured tools.'}</p></div>
              {modelError && <p className="personal-tasks-model-notice" role="alert">{zh ? `无法读取当前助理的模型：${modelError}` : `Could not read this Profile's model: ${modelError}`}</p>}
              {!modelError && modelName === null && <p className="personal-tasks-model-notice" role="status">{zh ? '正在读取当前助理的模型…' : 'Loading this Profile’s model…'}</p>}
              {!modelError && modelName === '' && <p className="personal-tasks-model-notice" role="status">{zh ? '当前助理尚未选择模型。点击下方按钮前往模型设置。' : 'This Profile has no model. Use the button below to open model settings.'}</p>}
              <label className="personal-tasks-field"><span>{zh ? '任务标题' : 'Task title'}</span><input ref={titleInput} value={title} maxLength={200} onChange={e => { setTitle(e.target.value); pendingCreate.current = null }} placeholder={zh ? '例如：整理竞品调研报告' : 'For example: Research competitor products'} /></label>
              <label className="personal-tasks-field"><span>{zh ? '目标与完成标准' : 'Goal and completion criteria'}</span><textarea value={goal} maxLength={20000} onChange={e => { setGoal(e.target.value); pendingCreate.current = null }} placeholder={zh ? '写下目标、交付内容和需要遵守的条件…' : 'Describe the outcome, deliverables and constraints…'} /></label>
              <label className="personal-tasks-team-choice"><input type="checkbox" checked={teamTask} onChange={event => { setTeamTask(event.target.checked); pendingCreate.current = null }} /><span><strong>{zh ? '由多个助理协作' : 'Work across Profiles'}</strong><small>{zh ? '先创建待拆解任务，再由 Hermes 分派子任务；全部完成后主助理汇总。' : 'Create a task for decomposition. Hermes assigns subtasks, then the lead Profile summarizes.'}</small></span></label>
              <div className="personal-tasks-form-footer"><span>{zh ? '任务会归属当前个人助理' : 'The task belongs to the selected Profile'}</span>{modelError
                ? <button type="button" className="personal-tasks-primary" onClick={() => setModelRead(value => value + 1)}>{zh ? '重新读取模型' : 'Retry model check'}</button>
                : modelName === ''
                ? <button type="button" className="personal-tasks-primary" onClick={() => onOpenModelSettings(profile)}>{zh ? '前往模型设置' : 'Open model settings'}</button>
                : <button className="personal-tasks-primary" disabled={busy || !modelReady || !title.trim() || !goal.trim()}>{zh ? '创建持续任务' : 'Create task'}</button>}</div>
            </form> : !detail ? <div className="personal-tasks-detail-empty" role="status">{error || (zh ? '正在读取任务详情…' : 'Loading task details…')}</div> : <div className="personal-tasks-detail">
              <div className="personal-tasks-panel-heading"><span className="personal-tasks-status">{statusNames[detail.task.status] || detail.task.status}</span><h2>{detail.task.title}</h2><p>{zh ? '创建于' : 'Created'} {taskEventTime(detail.task.created_at, language)}{progressEvents.length > 0 && <> · {zh ? '最近记录' : 'Last recorded activity'} {taskEventTime(progressEvents[progressEvents.length - 1].time, language)}</>}</p></div>
              <article><h3>{zh ? '任务目标' : 'Goal'}</h3><p>{detail.task.body}</p></article>
              {detail.task.assignee && <article><h3>{zh ? '执行助理' : 'Assigned Profile'}</h3><p>{profiles?.profiles.find(item => item.name === detail.task.assignee)?.display_name || detail.task.assignee}</p></article>}
              {detail.task.status === 'triage' && <div className="personal-tasks-actions"><button className="personal-tasks-primary" disabled={busy} onClick={() => void decompose()}>{busy ? (zh ? '正在拆解…' : 'Decomposing…') : (zh ? '拆解并分派给助理' : 'Decompose and assign')}</button></div>}
              {detail.child_results && detail.child_results.length > 0 && <article><h3>{zh ? '协作子任务' : 'Collaborating subtasks'}{detail.task.progress && ` · ${detail.task.progress.done}/${detail.task.progress.total}`}</h3><div className="personal-tasks-child-list">{detail.child_results.map(child => <div key={child.id}><strong>{child.title}</strong><span>{statusNames[child.status] || child.status}</span>{(child.latest_summary || child.result) && <p>{child.latest_summary || child.result}</p>}</div>)}</div></article>}
              <article className="personal-tasks-progress"><h3>{zh ? '执行进度' : 'Progress'}</h3>
                {progressEvents.length === 0 ? <p>{zh ? '暂无执行记录，等待调度。' : 'No activity recorded yet. Waiting for dispatch.'}</p> : <>{progressEvents.length > 15 && <p className="personal-tasks-progress-note">{zh ? `显示最近 15 条，共 ${progressEvents.length} 条记录。` : `Showing the latest 15 of ${progressEvents.length} entries.`}</p>}<ol>{progressEvents.slice(-15).map(event => <li key={event.id} className={event.kind === 'completed' ? 'completed' : ''}><span>{event.label}</span><time>{taskEventTime(event.time, language)}</time></li>)}</ol></>}
                {detail.task.status === 'running' && <p className="personal-tasks-progress-note">{zh ? '执行中；下一条记录会在任务有可确认的状态变化时出现。' : 'Running; the next entry appears when a confirmed task event is recorded.'}</p>}
              </article>
              {detail.task.failure && <p className="personal-tasks-notice error" role="alert">{detail.task.failure}</p>}
              {detail.task.summary && <article><h3>{zh ? '最近已记录摘要' : 'Last recorded summary'}</h3><p>{detail.task.summary}</p></article>}
              {detail.task.result && <article><h3>{zh ? '成果' : 'Result'}</h3><p>{detail.task.result}</p></article>}
              {detail.attachments.length > 0 && <article><h3>{zh ? '附件' : 'Attachments'}</h3>{detail.attachments.map(item => <p key={item.id}>{item.filename} · {item.size} B</p>)}</article>}
              {detail.comments.length > 0 && <article><h3>{zh ? '任务记录' : 'Task activity'}</h3>{detail.comments.map(item => <p key={item.id}><strong>{item.author}：</strong>{item.body}</p>)}</article>}
              {detail.task.status === 'blocked' && <div className="personal-tasks-reply"><label className="personal-tasks-field"><span>{zh ? '补充信息' : 'Add information'}</span><textarea value={reply} onChange={e => { setReply(e.target.value); pendingReply.current = null }} placeholder={zh ? '补充任务需要的信息' : 'Provide the missing information'} /></label>
                <div className="personal-tasks-actions"><button className="personal-tasks-primary" disabled={busy || !reply.trim()} onClick={() => void supplement()}>{zh ? '提交补充信息' : 'Submit information'}</button><button disabled={busy} onClick={() => void resume()}>{zh ? '继续原任务' : 'Resume task'}</button></div></div>}
              {detail.task.status !== 'archived' && <div className="personal-tasks-actions archive"><ConfirmActionButton disabled={busy} confirmLabel={zh ? '再次点击结束并归档' : 'Click again to end and archive'} onConfirm={() => void archive()}>{zh ? '结束并归档' : 'End and archive'}</ConfirmActionButton></div>}
              {detail.termination_pending && <p className="personal-tasks-notice error" role="alert">{zh ? '归档已记录，但执行进程仍在退出；请稍后确认。' : 'Archived; worker termination is pending.'}</p>}
            </div>}
          </section>
        </div>}
      </>}
    </div>
  </main>
}
