import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useGatewayRefresh } from '../../app/useGatewayRefresh'
import { useLanguage } from '../../i18n'
import ScheduledJobDetails, { type JobHistory } from './ScheduledJobDetails'
import ScheduledBlueprints from './ScheduledBlueprints'
import ScheduledTaskEditor from './ScheduledTaskEditor'
import { editJob, editorPayload, newEditor, type Editor, type Job, type ScopedJob } from './scheduledTaskModel'
import { elapsedLabel, nextRunOverdueMs, repeatLabel, scheduledJobState, scheduledJobStateCounts, scheduledJobStateLabel, schedulerStaleAge } from './scheduledTaskHealth'
import './scheduled-blueprints.css'
import './scheduled-tasks.css'

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
  const [triggering, setTriggering] = React.useState<ReadonlySet<string>>(new Set())
  const triggeringRef = React.useRef(new Set<string>())
  const [error, setError] = React.useState('')
  const [readFailed, setReadFailed] = React.useState(false)
  const [failedProfiles, setFailedProfiles] = React.useState<string[]>([])
  const [notice, setNotice] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [profileFilter, setProfileFilter] = React.useState('all')
  const [view, setView] = React.useState<'jobs' | 'blueprints'>('jobs')
  const [editor, setEditor] = React.useState<Editor | null>(null)
  const [detailsKey, setDetailsKey] = React.useState('')
  const detailsKeyRef = React.useRef(detailsKey)
  detailsKeyRef.current = detailsKey
  const [details, setDetails] = React.useState<JobHistory | null>(null)
  const [detailsLoading, setDetailsLoading] = React.useState(false)
  const [detailsError, setDetailsError] = React.useState('')
  const detailsRevision = React.useRef(0)
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
  useGatewayRefresh(connected, 'cron.changed', refresh)
  const profileName = (name: string) => profiles?.profiles.find(profile => profile.name === name)?.display_name || name
  React.useEffect(() => {
    if (profileFilter !== 'all' && !available.some(profile => profile.name === profileFilter)) setProfileFilter('all')
  }, [profileFilter, profileKey])
  const filteredJobs = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return jobs.filter(job => (profileFilter === 'all' || job.profile === profileFilter)
      && (!query || [job.name, job.prompt, job.id, job.profile, profileName(job.profile)]
        .some(value => value.toLocaleLowerCase().includes(query))))
  }, [jobs, search, profileFilter, profiles])
  const staleScheduler = React.useMemo(() => schedulerStaleAge(jobs), [jobs])
  const creatable = available.filter(profile => !failedProfiles.includes(profile.name))
  const stateCounts = scheduledJobStateCounts(jobs)
  const jobProfileCount = new Set(jobs.map(job => job.profile)).size

  function openEditor(job: ScopedJob, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger
    setEditor(editJob(job))
  }

  async function run(operation: 'jobs.pause' | 'jobs.resume' | 'jobs.cancel', job: ScopedJob) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await extensions.request<{ cancelled?: boolean }>({ kind: 'profile', profile: job.profile }, operation, { profile: job.profile, id: job.id })
      if (operation === 'jobs.cancel') {
        setNotice(result.cancelled
          ? (zh ? '已请求停止本次运行。' : 'Stop requested for this run.')
          : (zh ? '当前没有进行中的运行。' : 'There is no run in progress.'))
        if (detailsKeyRef.current === `${job.profile}:${job.id}`) await loadDetails(job)
      } else {
        setNotice(zh ? '状态已更新。' : 'Status updated.')
      }
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  async function trigger(job: ScopedJob) {
    const key = `${job.profile}:${job.id}`
    if (busy || triggeringRef.current.has(key)) return
    triggeringRef.current.add(key)
    setTriggering(new Set(triggeringRef.current))
    setError(''); setNotice('')
    try {
      const result = await extensions.request<{ job: Job }>({ kind: 'profile', profile: job.profile }, 'jobs.run', { profile: job.profile, id: job.id })
      await refresh()
      if (detailsKeyRef.current === key) await loadDetails(job)
      if (result.job.last_status === 'error') setError(zh ? '任务执行失败。请展开详情查看错误。' : 'The task failed. Open details to see the error.')
      else if (result.job.last_status === 'delivery_failed') setError(zh ? '任务已执行，但结果投递失败。请展开详情查看错误。' : 'The task ran, but delivery failed. Open details to see the error.')
      else if (result.job.last_status === 'ok') setNotice(zh ? '立即运行完成。' : 'Run completed.')
      else if (result.job.last_status === 'cancelled') setNotice(zh ? '本次运行已停止。' : 'The run stopped.')
      else setNotice(zh ? '运行请求已结束，请查看任务状态与记录。' : 'Run request finished. Check the task status and history.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally {
      triggeringRef.current.delete(key)
      setTriggering(new Set(triggeringRef.current))
    }
  }

  async function showDetails(job: ScopedJob) {
    const key = `${job.profile}:${job.id}`
    if (detailsKey === key) { setDetailsKey(''); setDetails(null); ++detailsRevision.current; return }
    await loadDetails(job)
  }

  async function loadDetails(job: ScopedJob) {
    const key = `${job.profile}:${job.id}`
    const revision = ++detailsRevision.current
    setDetailsKey(key); setDetails(null); setDetailsError(''); setDetailsLoading(true)
    try {
      const scope = { kind: 'profile' as const, profile: job.profile }
      const payload = { profile: job.profile, id: job.id }
      const [detail, history] = await Promise.all([
        extensions.request<{ job: JobHistory['job'] }>(scope, 'jobs.detail', payload),
        extensions.request<{ runs: JobHistory['runs'] }>(scope, 'jobs.runs', payload),
      ])
      if (revision === detailsRevision.current) setDetails({ job: detail.job, runs: history.runs })
    } catch (cause) { if (revision === detailsRevision.current) setDetailsError(describeError(cause, language)) }
    finally { if (revision === detailsRevision.current) setDetailsLoading(false) }
  }

  async function deleteJob(job: ScopedJob) {
    if (busy || !window.confirm(zh ? `永久删除定时任务「${job.name}」？` : `Permanently delete scheduled task “${job.name}”?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request({ kind: 'profile', profile: job.profile }, 'jobs.delete', { profile: job.profile, id: job.id })
      if (detailsKey === `${job.profile}:${job.id}`) { setDetailsKey(''); setDetails(null); ++detailsRevision.current }
      await refresh()
      setNotice(zh ? '定时任务已删除。' : 'Scheduled task deleted.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editor || busy || loading || failedProfiles.includes(editor.profile) || !editor.schedule.trim()
      || !(editor.prompt.trim() || editor.script.trim() || editor.skills.length)
      || editor.no_agent && !editor.script.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await extensions.request<{ job_saved?: boolean; scheduler_registered?: boolean }>({ kind: 'profile', profile: editor.profile }, editor.mode === 'create' ? 'jobs.create' : 'jobs.update', editorPayload(editor))
      closeEditor()
      await refresh()
      setNotice(result.job_saved && result.scheduler_registered === false
        ? (zh ? '任务已保存，但调度器尚未注册成功。请在任务列表中编辑或暂停后恢复，勿重复创建。' : 'Task saved, but scheduler registration failed. Edit it or pause and resume it; do not create a duplicate.')
        : (zh ? '定时任务已保存。' : 'Scheduled task saved.'))
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  return <section className="scheduled-design-page">
    <header className="scheduled-page-heading"><div><span className="scheduled-eyebrow">HERMESS · AUTOMATION</span><h2>{zh ? '定时任务' : 'Scheduled tasks'}</h2><p>{zh ? '统一管理所有 Profile 的计划、运行状态与自动化蓝图。' : 'Manage schedules, runtime state, and automation blueprints across profiles.'}</p></div>
      <div className="scheduled-heading-side"><span className={`scheduled-runtime-state ${connected ? 'is-online' : 'is-offline'}`}><i aria-hidden="true" />{zh ? (connected ? '调度运行时已连接' : '调度运行时未连接') : (connected ? 'Scheduler connected' : 'Scheduler offline')}</span>
      <div className="scheduled-heading-actions"><button type="button" disabled={!connected || loading} onClick={() => void refresh()}>{zh ? '刷新' : 'Refresh'}</button>
        <button className="design-primary-button" type="button" disabled={!connected || loading || !creatable.length} onClick={event => { editorTrigger.current = event.currentTarget; setEditor(newEditor(creatable.find(profile => profile.name === profiles?.selected)?.name || creatable[0].name)) }}>{zh ? '新建定时任务' : 'New scheduled task'}</button></div>
      </div>
    </header>
    <div className="scheduled-overview" aria-label={zh ? '定时任务概览' : 'Scheduled task overview'}>
      <div><strong>{jobs.length}</strong><span>{zh ? '全部任务' : 'All tasks'}</span></div>
      <div><strong>{stateCounts.scheduled || 0}</strong><span>{zh ? '已计划' : 'Scheduled'}</span></div>
      <div><strong>{stateCounts.paused || 0}</strong><span>{zh ? '已暂停' : 'Paused'}</span></div>
      <div><strong>{stateCounts.error || 0}</strong><span>{zh ? '调度错误' : 'Errors'}</span></div>
      <div><strong>{stateCounts.completed || 0}</strong><span>{zh ? '已完成' : 'Completed'}</span></div>
      <div><strong>{jobProfileCount || available.length}</strong><span>{zh ? '参与 Profile' : 'Profiles'}</span></div>
    </div>
    <div className="scheduled-view-tabs" role="tablist" aria-label={zh ? '定时任务视图' : 'Scheduled task views'}>
      <button type="button" role="tab" aria-selected={view === 'jobs'} onClick={() => setView('jobs')}>{zh ? '任务' : 'Jobs'}</button>
      <button type="button" role="tab" aria-selected={view === 'blueprints'} onClick={() => setView('blueprints')}>{zh ? '蓝图' : 'Blueprints'}</button>
    </div>
    {view === 'jobs' && staleScheduler !== null && <p className="scheduled-health-warning" role="alert">
      {zh ? `调度器最后一次心跳在 ${elapsedLabel(staleScheduler, true)}，已启用任务可能不会按时运行。` : `The scheduler last ticked ${elapsedLabel(staleScheduler, false)}; enabled jobs may not run on time.`}
    </p>}
    {view === 'blueprints' && !connected && <p className="scheduled-empty">{zh ? '启动运行时后可查看蓝图。' : 'Start the runtime to view blueprints.'}</p>}
    {view === 'blueprints' && connected && !available.length && <p className="scheduled-empty">{zh ? '当前没有正在服务的 Profile。' : 'No profile is currently served.'}</p>}
    {view === 'blueprints' && connected && available.length > 0 && <ScheduledBlueprints available={available} selected={available.find(item => item.name === profiles?.selected)?.name || available[0].name}
      onCreated={partial => { setView('jobs'); void refresh(); setNotice(partial
        ? (zh ? '任务已保存，但调度器尚未注册成功；请勿重复创建。' : 'Task saved, but scheduler registration failed. Do not create a duplicate.')
        : (zh ? '蓝图任务已创建。' : 'Blueprint task created.')) }} />}
    {view === 'jobs' && <>
    <div className="scheduled-jobs-toolbar"><div className="scheduled-search"><label htmlFor="scheduled-search-input">{zh ? '搜索任务' : 'Search tasks'}</label><input id="scheduled-search-input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={zh ? '搜索名称、提示词、任务 ID 或 Profile' : 'Search name, prompt, task ID, or Profile'} /></div>
      <label className="scheduled-profile-filter" htmlFor="scheduled-profile-filter">{zh ? '所属 Profile' : 'Profile'}<select id="scheduled-profile-filter" value={profileFilter} onChange={event => setProfileFilter(event.target.value)}><option value="all">{zh ? '全部 Profile' : 'All profiles'}</option>{available.map(profile => <option key={profile.name} value={profile.name}>{profile.display_name || profile.name}</option>)}</select></label>
      <span>{zh ? `${filteredJobs.length} 项结果` : `${filteredJobs.length} results`}</span></div>
    {!connected && <p className="scheduled-empty">{zh ? '启动运行时后可查看定时任务。' : 'Start the runtime to view scheduled tasks.'}</p>}
    {connected && !available.length && <p className="scheduled-empty">{zh ? '当前没有正在服务的 Profile。' : 'No profile is currently served.'}</p>}
    {error && <div role="alert" className="scheduled-error">{error} {readFailed && <button type="button" disabled={loading} onClick={() => void refresh()}>{zh ? '重试读取' : 'Retry'}</button>}</div>}
    {notice && <p role="status" className="scheduled-notice">{notice}</p>}
    {connected && available.length > 0 && <div className="scheduled-list">
      <div className="scheduled-list-header"><span>{zh ? '任务' : 'Task'}</span><span>{zh ? '所属 Profile' : 'Profile'}</span><span>{zh ? '下次运行' : 'Next run'}</span><span>{zh ? '状态' : 'Status'}</span><span>{zh ? '操作' : 'Actions'}</span></div>
      {loading && !jobs.length && <p className="scheduled-empty">{zh ? '读取任务中…' : 'Loading tasks…'}</p>}
      {!loading && !jobs.length && !readFailed && <p className="scheduled-empty">{zh ? '还没有定时任务。点击右上角创建。' : 'No scheduled tasks yet. Create one above.'}</p>}
      {!loading && jobs.length > 0 && !filteredJobs.length && <p className="scheduled-empty">{zh ? '没有匹配的定时任务。' : 'No matching scheduled tasks.'}</p>}
      {filteredJobs.map(job => { const overdue = nextRunOverdueMs(job); const state = scheduledJobState(job); return <React.Fragment key={`${job.profile}:${job.id}`}><div className="scheduled-list-row">
        <div className="scheduled-row-task"><strong>{job.name}</strong><small>{zh ? '计划：' : 'Schedule: '}{job.schedule_display || job.schedule?.display || job.schedule?.expr || '—'} · {zh ? '重复：' : 'Repeat: '}{repeatLabel(job.repeat, zh)}</small></div>
        <span>{profileName(job.profile)}</span><span className={overdue === null ? '' : 'scheduled-overdue'} title={overdue === null ? undefined : (zh ? '下次运行时间已明显超期' : 'The next run is substantially overdue')}>{overdue === null ? formatDate(job.next_run_at, language) : `${zh ? '超期自' : 'Overdue since'} ${formatDate(job.next_run_at, language)}`}</span>
        <div className="scheduled-row-status"><span className={`scheduled-status-badge is-${['scheduled', 'paused', 'error', 'completed', 'disabled'].includes(state) ? state : 'unknown'}`}>{scheduledJobStateLabel(state, zh)}</span><small>{zh ? '最近执行：' : 'Last run: '}{formatDate(job.last_run_at, language)}{job.last_status ? ` · ${job.last_status}` : ''}</small>{job.last_delivery_error && <small className="scheduled-row-error">{zh ? '投递：' : 'Delivery: '}{job.last_delivery_error}</small>}{job.last_fire_error?.detail && <small className="scheduled-row-error">{zh ? '错过计划执行：' : 'Missed scheduled fire: '}{job.last_fire_error.detail}</small>}{job.last_error && <small className="scheduled-row-error">{job.last_error}</small>}</div>
        <div className="scheduled-row-actions">
          <button type="button" disabled={busy || loading} aria-label={`${zh ? '详情' : 'Details'} ${job.name}`} aria-expanded={detailsKey === `${job.profile}:${job.id}`} onClick={() => void showDetails(job)}>{zh ? '详情' : 'Details'}</button>
          <button type="button" disabled={busy || loading || triggering.has(`${job.profile}:${job.id}`)} aria-label={`${zh ? '编辑' : 'Edit'} ${job.name}`} onClick={event => openEditor(job, event.currentTarget)}>{zh ? '编辑' : 'Edit'}</button>
          <button type="button" disabled={busy || loading || triggering.has(`${job.profile}:${job.id}`)} aria-label={`${zh ? '立即运行' : 'Run now'} ${job.name}`} onClick={() => void trigger(job)}>{triggering.has(`${job.profile}:${job.id}`) ? (zh ? '运行中…' : 'Running…') : (zh ? '立即运行' : 'Run now')}</button>
          <button type="button" disabled={busy || loading} aria-label={`${zh ? '停止本次运行' : 'Stop current run'} ${job.name}`} onClick={() => void run('jobs.cancel', job)}>{zh ? '停止本次运行' : 'Stop current run'}</button>
          <button type="button" disabled={busy || loading || triggering.has(`${job.profile}:${job.id}`)} aria-label={`${state === 'paused' ? (zh ? '恢复' : 'Resume') : (zh ? '暂停' : 'Pause')} ${job.name}`} onClick={() => void run(state === 'paused' ? 'jobs.resume' : 'jobs.pause', job)}>{state === 'paused' ? (zh ? '恢复' : 'Resume') : (zh ? '暂停' : 'Pause')}</button>
          <button type="button" className="scheduled-delete" disabled={busy || loading || triggering.has(`${job.profile}:${job.id}`)} aria-label={`${zh ? '删除' : 'Delete'} ${job.name}`} onClick={() => void deleteJob(job)}>{zh ? '删除' : 'Delete'}</button>
        </div>
      </div>{detailsKey === `${job.profile}:${job.id}` && <ScheduledJobDetails details={details} loading={detailsLoading} error={detailsError} language={language} />}</React.Fragment> })}
    </div>}
    {editor && <ScheduledTaskEditor editor={editor} onChange={setEditor} onClose={closeEditor} onSubmit={event => void save(event)}
      available={available} failedProfiles={failedProfiles} busy={busy} loading={loading} />}
    </>}
  </section>
}
