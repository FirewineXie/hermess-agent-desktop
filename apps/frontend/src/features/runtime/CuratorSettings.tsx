import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import './curator-settings.css'

type CuratorStatus = {
  enabled: boolean
  paused: boolean
  interval_hours: number | null
  last_run_at: string | null
}

type CuratorRunStatus = {
  id: string
  running: boolean
  exit_code: number | null
  error: string | null
  lines: string[]
}

export default function CuratorSettings({ connected, profile, language }: {
  connected: boolean; profile: string | null; language: 'zh-CN' | 'en-US'
}) {
  const { extensions } = useDesktop()
  const zh = language === 'zh-CN'
  const [status, setStatus] = React.useState<CuratorStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [runStatus, setRunStatus] = React.useState<CuratorRunStatus | null>(null)
  const [revision, refresh] = React.useReducer(value => value + 1, 0)

  React.useEffect(() => {
    if (!connected || !profile) { setStatus(null); setRunStatus(null); setError(''); return }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setBusy(true); setError('')
    void Promise.all([
      extensions.request<CuratorStatus>({ kind: 'profile', profile }, 'curator.status', { profile }),
      extensions.request<CuratorRunStatus | null>({ kind: 'profile', profile }, 'curator.runStatus', { profile }),
    ])
      .then(([value, run]) => {
        if (!active) return
        setStatus(value); setRunStatus(run)
        if (run?.running) timer = setTimeout(() => refresh(), 1200)
      })
      .catch(cause => { if (active) setError(describeError(cause, language)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [connected, profile, extensions, language, revision])

  const toggle = async () => {
    if (!profile || !status || busy) return
    setBusy(true); setError('')
    try {
      const changed = await extensions.request<{ ok: boolean; paused: boolean }>(
        { kind: 'profile', profile }, 'curator.pause', { profile, paused: !status.paused })
      setStatus(value => value ? { ...value, paused: changed.paused } : value)
      refresh()
    } catch (cause) { setError(describeError(cause, language)); setBusy(false) }
  }

  const run = async () => {
    if (!profile || !status?.enabled || busy || runStatus?.running) return
    setBusy(true); setError(''); setNotice('')
    try {
      const started = await extensions.request<CuratorRunStatus>({ kind: 'profile', profile }, 'curator.run', { profile })
      setRunStatus(started)
      setNotice(zh ? '整理任务已启动，可在下方查看实时输出。' : 'Curator review started. Live output appears below.')
      refresh()
    } catch (cause) { setError(describeError(cause, language)); setBusy(false) }
  }

  return <section className="settings-panel curator-settings">
    <header className="curator-settings-header"><div><h2>{zh ? '技能整理器' : 'Skill curator'}</h2>
      <p>{zh ? '查看当前 Profile 的自动技能整理状态，暂停或恢复定期整理，也可立即运行一次。' : 'View, pause, resume, or run the skill curator for this Profile.'}</p></div>
      <button type="button" disabled={!connected || !profile || busy} onClick={refresh}>{zh ? '刷新' : 'Refresh'}</button></header>
    {(!connected || !profile) && <p className="curator-settings-empty">{zh ? '请先连接运行时并选择 Profile。' : 'Connect the runtime and select a Profile.'}</p>}
    {connected && profile && busy && !status && <p role="status">{zh ? '正在读取整理状态…' : 'Loading curator status…'}</p>}
    {error && <p role="alert" className="curator-settings-error">{error}</p>}
    {notice && <p role="status" className="curator-settings-notice">{notice}</p>}
    {status && <div className="curator-settings-detail">
      <div className="curator-settings-summary"><span className="curator-settings-label">{zh ? '当前状态' : 'Current status'}</span>
        <strong data-state={status.paused ? 'paused' : status.enabled ? 'active' : 'disabled'}>{status.paused ? (zh ? '已暂停' : 'Paused') : status.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '未启用' : 'Disabled')}</strong></div>
      <dl><div><dt>{zh ? '整理间隔' : 'Interval'}</dt><dd>{status.interval_hours ? `${status.interval_hours} ${zh ? '小时' : 'hours'}` : '—'}</dd></div>
        <div><dt>{zh ? '上次运行' : 'Last run'}</dt><dd>{status.last_run_at ? new Date(status.last_run_at).toLocaleString(language) : (zh ? '尚未运行' : 'Never')}</dd></div></dl>
      <div className="curator-settings-actions"><button type="button" disabled={busy || !status.enabled} onClick={() => void toggle()}>{status.paused ? (zh ? '恢复定期整理' : 'Resume schedule') : (zh ? '暂停定期整理' : 'Pause schedule')}</button>
        <button className="curator-settings-primary" type="button" disabled={busy || !status.enabled || !!runStatus?.running} onClick={() => void run()}>{runStatus?.running ? (zh ? '整理中…' : 'Running…') : busy ? (zh ? '处理中…' : 'Working…') : (zh ? '立即运行' : 'Run now')}</button></div>
      {runStatus && <div className="curator-run-output">
        <p role="status">{runStatus.running ? (zh ? '整理器正在运行' : 'Curator is running')
          : runStatus.error ? (zh ? '整理器运行失败' : 'Curator run failed')
            : runStatus.exit_code === 0 ? (zh ? '整理器运行完成' : 'Curator run completed')
              : (zh ? `整理器退出码：${runStatus.exit_code ?? '未知'}` : `Curator exit code: ${runStatus.exit_code ?? 'unknown'}`)}</p>
        {runStatus.error && <p role="alert" className="curator-settings-error">{runStatus.error}</p>}
        <pre aria-label={zh ? '整理器输出' : 'Curator output'}>{runStatus.lines.length
          ? runStatus.lines.map(line => line.replace(/\u001b\[[0-9;]*m/g, '')).join('\n')
          : (runStatus.running ? (zh ? '正在等待输出…' : 'Waiting for output…') : (zh ? '没有输出。' : 'No output.'))}</pre>
      </div>}
    </div>}
  </section>
}
