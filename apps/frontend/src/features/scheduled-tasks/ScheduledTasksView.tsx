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

export default function ScheduledTasksView({ connected, epoch, profiles }: { connected: boolean; epoch: string | null; profiles: ProfilesSnapshot | null }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [jobs, setJobs] = React.useState<ScopedJob[]>([])
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [readFailed, setReadFailed] = React.useState(false)
  const [failedProfiles, setFailedProfiles] = React.useState<string[]>([])
  const [notice, setNotice] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [editor, setEditor] = React.useState<Editor | null>(null)
  const refreshVersion = React.useRef(0)
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
  const served = React.useMemo(() => new Set(profiles?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]) || []), [profiles])
  const available = React.useMemo(() => profiles?.profiles.filter(profile => served.has(profile.name)) || [], [profiles, served])
  const profileKey = available.map(profile => profile.name).join('|')

  const refresh = React.useCallback(async () => {
    const version = ++refreshVersion.current
    if (!connected || available.length === 0) { setJobs([]); setLoading(false); setError(''); setReadFailed(false); setFailedProfiles([]); return }
    setLoading(true); setError(''); setReadFailed(false); setFailedProfiles([])
    const results = await Promise.allSettled(available.map(profile => extensions.request<{ jobs: Job[] }>({ kind: 'profile', profile: profile.name }, 'jobs.list', { profile: profile.name })))
    if (version !== refreshVersion.current) return
    const loaded = results.flatMap((result, index) => result.status === 'fulfilled' ? result.value.jobs.map(job => ({ ...job, profile: available[index].name })) : [])
    setJobs(loaded)
    const failures = results.flatMap((result, index) => result.status === 'rejected'
      ? [`${available[index].display_name || available[index].name}: ${describeError(result.reason, language)}`] : [])
    setFailedProfiles(results.flatMap((result, index) => result.status === 'rejected' ? [available[index].name] : []))
    setReadFailed(failures.length > 0)
    setError(failures.length ? `${zh ? '以下 Profile 的任务读取失败：' : 'Tasks could not be loaded for: '}${failures.join(zh ? '；' : '; ')}` : '')
    setLoading(false)
  }, [connected, epoch, extensions, profileKey, language])

  React.useEffect(() => { void refresh(); return () => { ++refreshVersion.current } }, [refresh])
  const profileName = (name: string) => profiles?.profiles.find(profile => profile.name === name)?.display_name || name
  const filteredJobs = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return jobs
    return jobs.filter(job => [job.name, job.prompt, job.id, job.profile, profileName(job.profile)]
      .some(value => value.toLocaleLowerCase().includes(query)))
  }, [jobs, search, profiles])
  const creatable = available.filter(profile => !failedProfiles.includes(profile.name))

  function openEditor(job: ScopedJob, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger
    setEditor({ mode: 'edit', profile: job.profile, id: job.id, name: job.name, schedule: job.schedule?.expr || job.schedule_display || '', prompt: job.prompt })
  }

  async function run(operation: string, job: ScopedJob) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request({ kind: 'profile', profile: job.profile }, operation, { profile: job.profile, id: job.id })
      if (operation === 'jobs.run') {
        setNotice(zh ? '已发起立即运行请求。执行结果稍后点击刷新查看。' : 'Run request started. Refresh later to check the result.')
      } else {
        setNotice(zh ? '状态已更新。' : 'Status updated.')
        await refresh()
      }
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editor || busy || loading || failedProfiles.includes(editor.profile) || !editor.name.trim() || !editor.schedule.trim() || !editor.prompt.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await extensions.request<{ job_saved?: boolean; scheduler_registered?: boolean }>({ kind: 'profile', profile: editor.profile }, editor.mode === 'create' ? 'jobs.create' : 'jobs.update', {
        profile: editor.profile, ...(editor.mode === 'edit' ? { id: editor.id } : {}),
        name: editor.name.trim(), schedule: editor.schedule.trim(), prompt: editor.prompt.trim(),
      })
      closeEditor()
      await refresh()
      setNotice(result.job_saved && result.scheduler_registered === false
        ? (zh ? '任务已保存，但调度器尚未注册成功。请在任务列表中编辑或暂停后恢复，勿重复创建。' : 'Task saved, but scheduler registration failed. Edit it or pause and resume it; do not create a duplicate.')
        : (zh ? '定时任务已保存。' : 'Scheduled task saved.'))
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  return <section className="scheduled-design-page">
    <header className="design-page-heading"><div><h2>{zh ? '定时任务' : 'Scheduled tasks'}</h2><p>{zh ? '查看所有 Profile 的计划任务与执行情况' : 'View scheduled tasks across profiles'}</p></div>
      <div className="scheduled-heading-actions"><button type="button" disabled={!connected || loading} onClick={() => void refresh()}>{zh ? '刷新' : 'Refresh'}</button>
        <button className="design-primary-button" type="button" disabled={!connected || loading || !creatable.length} onClick={event => { editorTrigger.current = event.currentTarget; setEditor({ mode: 'create', profile: creatable.find(profile => profile.name === profiles?.selected)?.name || creatable[0].name, id: '', name: '', schedule: '', prompt: '' }) }}>{zh ? '新建定时任务' : 'New scheduled task'}</button></div></header>
    <div className="scheduled-search"><label htmlFor="scheduled-search-input">{zh ? '搜索全部定时任务' : 'Search all scheduled tasks'}</label><input id="scheduled-search-input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={zh ? '搜索名称、提示词、任务 ID 或 Profile' : 'Search name, prompt, task ID, or Profile'} /></div>
    {!connected && <p className="scheduled-empty">{zh ? '启动运行时后可查看定时任务。' : 'Start the runtime to view scheduled tasks.'}</p>}
    {connected && !available.length && <p className="scheduled-empty">{zh ? '当前没有正在服务的 Profile。' : 'No profile is currently served.'}</p>}
    {error && <div role="alert" className="scheduled-error">{error} {readFailed && <button type="button" disabled={loading} onClick={() => void refresh()}>{zh ? '重试读取' : 'Retry'}</button>}</div>}
    {notice && <p role="status" className="scheduled-notice">{notice}</p>}
    {connected && available.length > 0 && <div className="scheduled-list">
      <div className="scheduled-list-header"><span>{zh ? '任务' : 'Task'}</span><span>{zh ? '所属 Profile' : 'Profile'}</span><span>{zh ? '下次运行' : 'Next run'}</span><span>{zh ? '状态' : 'Status'}</span><span>{zh ? '操作' : 'Actions'}</span></div>
      {loading && !jobs.length && <p className="scheduled-empty">{zh ? '读取任务中…' : 'Loading tasks…'}</p>}
      {!loading && !jobs.length && !readFailed && <p className="scheduled-empty">{zh ? '还没有定时任务。点击右上角创建。' : 'No scheduled tasks yet. Create one above.'}</p>}
      {!loading && jobs.length > 0 && !filteredJobs.length && <p className="scheduled-empty">{zh ? '没有匹配的定时任务。' : 'No matching scheduled tasks.'}</p>}
      {filteredJobs.map(job => <div className="scheduled-list-row" key={`${job.profile}:${job.id}`}>
        <div className="scheduled-row-task"><strong>{job.name}</strong><small>{zh ? '计划：' : 'Schedule: '}{job.schedule_display || job.schedule?.display || job.schedule?.expr || '—'}</small></div>
        <span>{profileName(job.profile)}</span><span>{formatDate(job.next_run_at, language)}</span>
        <div className="scheduled-row-status"><span>{job.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已暂停' : 'Paused')}</span><small>{zh ? '最近执行：' : 'Last run: '}{formatDate(job.last_run_at, language)}{job.last_status ? ` · ${job.last_status}` : ''}</small></div>
        <div className="scheduled-row-actions">
          <button type="button" disabled={busy || loading} aria-label={`${zh ? '编辑' : 'Edit'} ${job.name}`} onClick={event => openEditor(job, event.currentTarget)}>{zh ? '编辑' : 'Edit'}</button>
          <button type="button" disabled={busy || loading} aria-label={`${zh ? '立即运行' : 'Run now'} ${job.name}`} onClick={() => void run('jobs.run', job)}>{zh ? '立即运行' : 'Run now'}</button>
          <button type="button" disabled={busy || loading} aria-label={`${job.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')} ${job.name}`} onClick={() => void run(job.enabled ? 'jobs.pause' : 'jobs.resume', job)}>{job.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</button>
        </div>
      </div>)}
    </div>}
    {editor && <div className="scheduled-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) closeEditor() }}><form className="scheduled-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-modal-title" onSubmit={event => void save(event)}>
      <div className="row"><h3 id="scheduled-modal-title">{editor.mode === 'create' ? (zh ? '新建定时任务' : 'New scheduled task') : (zh ? '编辑定时任务' : 'Edit scheduled task')}</h3><button type="button" disabled={busy} onClick={closeEditor} aria-label={zh ? '关闭' : 'Close'}>×</button></div>
      <div className="scheduled-modal-body"><label>{zh ? '所属 Profile' : 'Profile'}<select value={editor.profile} disabled={editor.mode === 'edit'} onChange={event => setEditor({ ...editor, profile: event.target.value })}>{available.map(profile => <option key={profile.name} value={profile.name} disabled={failedProfiles.includes(profile.name)}>{profile.display_name || profile.name}{failedProfiles.includes(profile.name) ? (zh ? '（读取失败）' : ' (unavailable)') : ''}</option>)}</select></label>
      <label>{zh ? '名称' : 'Name'}<input required maxLength={100} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
      <label>{zh ? '执行计划' : 'Schedule'}<input required maxLength={200} placeholder="0 9 * * *" value={editor.schedule} onChange={event => setEditor({ ...editor, schedule: event.target.value })} /></label>
      <p>{zh ? '支持 Cron 表达式，例如 0 9 * * * 表示每天 09:00。' : 'Cron expressions are supported. For example, 0 9 * * * means 09:00 daily.'}</p>
      <label>{zh ? '任务提示词' : 'Task prompt'}<textarea required maxLength={20000} rows={6} value={editor.prompt} onChange={event => setEditor({ ...editor, prompt: event.target.value })} /></label></div>
      <div className="scheduled-modal-actions"><button type="button" disabled={busy} onClick={closeEditor}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={busy || loading || failedProfiles.includes(editor.profile) || !editor.name.trim() || !editor.schedule.trim() || !editor.prompt.trim()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</button></div>
    </form></div>}
  </section>
}
