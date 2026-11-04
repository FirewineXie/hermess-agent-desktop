import React from 'react'
import type { SystemStats } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import './host-system-stats.css'

function bytes(value: number | undefined, language: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
  const unit = value >= 1024 ** 3 ? 'GB' : value >= 1024 ** 2 ? 'MB' : 'KB'
  const size = unit === 'GB' ? value / 1024 ** 3 : unit === 'MB' ? value / 1024 ** 2 : value / 1024
  return `${size.toLocaleString(language, { maximumFractionDigits: 1 })} ${unit}`
}

export default function HostSystemStats({ connected }: { connected: boolean }) {
  const { runtime } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [stats, setStats] = React.useState<SystemStats | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [revision, refresh] = React.useReducer(value => value + 1, 0)

  React.useEffect(() => {
    if (!connected) { setStats(null); setError(''); return }
    let active = true
    setLoading(true); setError('')
    void runtime.systemStats().then(result => { if (active) setStats(result) })
      .catch(cause => { if (active) setError(describeError(cause, language)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [connected, revision, runtime, language])

  const rows = stats ? [
    [zh ? '系统' : 'OS', `${stats.os} ${stats.os_release}`],
    [zh ? '架构' : 'Architecture', stats.arch],
    [zh ? '主机' : 'Host', stats.hostname],
    ['Python', `${stats.python_impl} ${stats.python_version}`],
    ['Hermes', stats.hermes_version && stats.hermes_version !== 'unknown'
      ? `v${stats.hermes_version}` : (zh ? '版本未知' : 'Version unknown')],
    ['CPU', `${stats.cpu_count ?? '—'} ${zh ? '核' : 'cores'}${typeof stats.cpu_percent === 'number' ? ` · ${stats.cpu_percent.toFixed(0)}%` : ''}`],
    ...(stats.load_avg && stats.load_avg.length >= 3 ? [[zh ? '平均负载' : 'Load average', stats.load_avg.slice(0, 3).map(value => value.toFixed(2)).join(' / ')]] : []),
    ...(stats.memory ? [[zh ? '内存' : 'Memory', `${bytes(stats.memory.used, language)} / ${bytes(stats.memory.total, language)} · ${stats.memory.percent}%`]] : []),
    ...(stats.disk ? [[zh ? '磁盘' : 'Disk', `${bytes(stats.disk.used, language)} / ${bytes(stats.disk.total, language)} · ${stats.disk.percent}%`]] : []),
    ...(typeof stats.uptime_seconds === 'number' ? [[zh ? '系统运行时间' : 'System uptime', `${Math.floor(stats.uptime_seconds / 86400)} ${zh ? '天' : 'days'} ${Math.floor(stats.uptime_seconds % 86400 / 3600)} ${zh ? '小时' : 'hours'}`]] : []),
    ...(stats.process ? [[zh ? 'Gateway 进程' : 'Gateway process', `PID ${stats.process.pid} · ${bytes(stats.process.rss, language)} · ${stats.process.num_threads} ${zh ? '线程' : 'threads'}`]] : []),
  ] : []

  return <section className="host-system-stats" aria-label={zh ? '主机与运行时状态' : 'Host and runtime status'}>
    <div className="host-system-heading"><div><h2>{zh ? '主机与运行时' : 'Host and runtime'}</h2>
      <p>{zh ? '来自本应用管理的 Hermes Gateway。' : 'Reported by the Hermes Gateway managed by this app.'}</p></div>
      <button type="button" disabled={!connected || loading} onClick={refresh}>{zh ? '刷新' : 'Refresh'}</button></div>
    {!connected && <p role="status">{zh ? '连接运行时后可查看。' : 'Connect the runtime to view system status.'}</p>}
    {connected && loading && !stats && <p role="status">{zh ? '正在读取主机状态…' : 'Loading host status…'}</p>}
    {error && <p role="alert">{error}</p>}
    {stats && <><dl className="host-system-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
      {!stats.psutil && <p className="host-system-note">{zh ? 'Gateway 未提供 CPU 使用率、内存和磁盘等扩展指标。' : 'Extended CPU, memory, and disk metrics are unavailable from the Gateway.'}</p>}</>}
  </section>
}
