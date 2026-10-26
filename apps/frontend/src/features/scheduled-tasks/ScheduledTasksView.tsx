import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type Job = {
  id: string; name: string; prompt: string; schedule_display?: string
  schedule?: { kind?: string; expr?: string; display?: string }
  next_run_at?: string | null; last_run_at?: string | null; last_status?: string | null
  state?: string; enabled?: boolean
}
type ScopedJob = Job & { profile: string }
type Editor = { mode: 'create' | 'edit'; profile: string; id: string; name: string; schedule: string; prompt: string }

function formatDate(value: string | null | undefined, language: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export default function ScheduledTasksView({ connected, profiles }: { connected: boolean; profiles: ProfilesSnapshot | null }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [jobs, setJobs] = React.useState<ScopedJob[]>([])
  const [selectedId, setSelectedId] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [editor, setEditor] = React.useState<Editor | null>(null)
  const editorTrigger = React.useRef<HTMLButtonElement | null>(null)
  const closeEditor = () => { setEditor(null); queueMicrotask(() => editorTrigger.current?.focus()) }
  React.useEffect(() => {
    if (!editor) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) closeEditor() }
    document.addEventListener('keydown', onEscape)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onEscape) }
  }, [Boolean(editor), busy])
  const served = React.useMemo(() => new Set(profiles?.gateways.flatMap(gateway => gateway.served_profiles || [gateway.profile]) || []), [profiles])
  const available = React.useMemo(() => profiles?.profiles.filter(profile => served.has(profile.name)) || [], [profiles, served])
  const profileKey = available.map(profile => profile.name).join('|')

  const refresh = React.useCallback(async () => {
    if (!connected || available.length === 0) { setJobs([]); return }
    setLoading(true); setError('')
    const results = await Promise.allSettled(available.map(profile => extensions.request<{ jobs: Job[] }>('jobs.list', { profile: profile.name })))
    const loaded = results.flatMap((result, index) => result.status === 'fulfilled' ? result.value.jobs.map(job => ({ ...job, profile: available[index].name })) : [])
    setJobs(loaded)
    setSelectedId(current => loaded.some(job => `${job.profile}:${job.id}` === current) ? current : loaded.length ? `${loaded[0].profile}:${loaded[0].id}` : '')
    if (results.some(result => result.status === 'rejected')) setError(zh ? '部分 Profile 的任务读取失败，请重试。' : 'Some profiles could not be loaded. Retry.')
    setLoading(false)
  }, [connected, extensions, profileKey, language])

  React.useEffect(() => { void refresh() }, [refresh])
  const selected = jobs.find(job => `${job.profile}:${job.id}` === selectedId)
  const profileName = (name: string) => profiles?.profiles.find(profile => profile.name === name)?.display_name || name

  async function run(operation: string, job: ScopedJob) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request(operation, { profile: job.profile, id: job.id })
      setNotice(operation === 'jobs.run' ? (zh ? '已提交立即运行请求。' : 'Run request submitted.') : (zh ? '状态已更新。' : 'Status updated.'))
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editor || busy || !editor.name.trim() || !editor.schedule.trim() || !editor.prompt.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request(editor.mode === 'create' ? 'jobs.create' : 'jobs.update', {
        profile: editor.profile, ...(editor.mode === 'edit' ? { id: editor.id } : {}),
        name: editor.name.trim(), schedule: editor.schedule.trim(), prompt: editor.prompt.trim(),
      })
      closeEditor()
      setNotice(zh ? '定时任务已保存。' : 'Scheduled task saved.')
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  return <section className="scheduled-design-page">
    <header className="design-page-heading"><div><h2>{zh ? '定时任务' : 'Scheduled tasks'}</h2><p>{zh ? '查看所有 Profile 的计划任务与执行情况' : 'View scheduled tasks across profiles'}</p></div>
      <button className="design-primary-button" type="button" disabled={!connected || !available.length} onClick={event => { editorTrigger.current = event.currentTarget; setEditor({ mode: 'create', profile: available.find(profile => profile.name === profiles?.selected)?.name || available[0].name, id: '', name: '', schedule: '', prompt: '' }) }}>{zh ? '新建定时任务' : 'New scheduled task'}</button></header>
    {!connected && <p className="scheduled-empty">{zh ? '启动运行时后可查看定时任务。' : 'Start the runtime to view scheduled tasks.'}</p>}
    {connected && !available.length && <p className="scheduled-empty">{zh ? '当前没有正在服务的 Profile。' : 'No profile is currently served.'}</p>}
    {error && <p role="alert" className="scheduled-error">{error}</p>}
    {notice && <p role="status" className="scheduled-notice">{notice}</p>}
    {connected && available.length > 0 && <div className="scheduled-layout"><div className="scheduled-list">
      <div className="scheduled-list-header"><span>{zh ? '任务' : 'Task'}</span><span>{zh ? '所属 Profile' : 'Profile'}</span><span>{zh ? '下次运行' : 'Next run'}</span><span>{zh ? '状态' : 'Status'}</span></div>
      {loading && !jobs.length && <p className="scheduled-empty">{zh ? '读取任务中…' : 'Loading tasks…'}</p>}
      {!loading && !jobs.length && <p className="scheduled-empty">{zh ? '还没有定时任务。点击右上角创建。' : 'No scheduled tasks yet. Create one above.'}</p>}
      {jobs.map(job => <button className={`scheduled-list-row ${selectedId === `${job.profile}:${job.id}` ? 'selected' : ''}`} type="button" key={`${job.profile}:${job.id}`} onClick={() => setSelectedId(`${job.profile}:${job.id}`)}>
        <strong>{job.name}</strong><span>{profileName(job.profile)}</span><span>{formatDate(job.next_run_at, language)}</span><span>{job.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已暂停' : 'Paused')}</span>
      </button>)}
    </div>{selected && <aside className="scheduled-detail"><h3>{selected.name}</h3><dl>
      <dt>{zh ? '所属 Profile' : 'Profile'}</dt><dd>{profileName(selected.profile)}</dd>
      <dt>{zh ? '计划' : 'Schedule'}</dt><dd>{selected.schedule_display || '—'}</dd>
      <dt>{zh ? '下次运行' : 'Next run'}</dt><dd>{formatDate(selected.next_run_at, language)}</dd>
      <dt>{zh ? '最近执行' : 'Last run'}</dt><dd>{formatDate(selected.last_run_at, language)}{selected.last_status ? ` · ${selected.last_status}` : ''}</dd>
    </dl><div className="scheduled-detail-actions">
      <button type="button" disabled={busy} onClick={() => void run('jobs.run', selected)}>{zh ? '立即运行' : 'Run now'}</button>
      <button type="button" disabled={busy} onClick={event => { editorTrigger.current = event.currentTarget; setEditor({ mode: 'edit', profile: selected.profile, id: selected.id, name: selected.name, schedule: selected.schedule?.expr || selected.schedule_display || '', prompt: selected.prompt }) }}>{zh ? '编辑计划' : 'Edit task'}</button>
      <button type="button" disabled={busy} onClick={() => void run(selected.enabled ? 'jobs.pause' : 'jobs.resume', selected)}>{selected.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</button>
    </div></aside>}</div>}
    {editor && <div className="scheduled-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) closeEditor() }}><form className="scheduled-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-modal-title" onSubmit={event => void save(event)}>
      <div className="row"><h3 id="scheduled-modal-title">{editor.mode === 'create' ? (zh ? '新建定时任务' : 'New scheduled task') : (zh ? '编辑定时任务' : 'Edit scheduled task')}</h3><button type="button" disabled={busy} onClick={closeEditor} aria-label={zh ? '关闭' : 'Close'}>×</button></div>
      <div className="scheduled-modal-body"><label>{zh ? '所属 Profile' : 'Profile'}<select value={editor.profile} disabled={editor.mode === 'edit'} onChange={event => setEditor({ ...editor, profile: event.target.value })}>{available.map(profile => <option key={profile.name} value={profile.name}>{profile.display_name || profile.name}</option>)}</select></label>
      <label>{zh ? '名称' : 'Name'}<input required maxLength={100} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
      <label>{zh ? '执行计划' : 'Schedule'}<input required maxLength={200} placeholder="0 9 * * *" value={editor.schedule} onChange={event => setEditor({ ...editor, schedule: event.target.value })} /></label>
      <p>{zh ? '支持 Cron 表达式，例如 0 9 * * * 表示每天 09:00。' : 'Cron expressions are supported. For example, 0 9 * * * means 09:00 daily.'}</p>
      <label>{zh ? '任务提示词' : 'Task prompt'}<textarea required maxLength={20000} rows={6} value={editor.prompt} onChange={event => setEditor({ ...editor, prompt: event.target.value })} /></label></div>
      <div className="scheduled-modal-actions"><button type="button" disabled={busy} onClick={closeEditor}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={busy || !editor.name.trim() || !editor.schedule.trim() || !editor.prompt.trim()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</button></div>
    </form></div>}
  </section>
}
