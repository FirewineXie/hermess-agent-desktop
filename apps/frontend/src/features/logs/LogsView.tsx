import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { classifyLogLine } from './logLineModel'
import './logs.css'

const files = ['agent', 'errors', 'gateway'] as const
const levels = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR'] as const
const components = ['all', 'gateway', 'agent', 'tools', 'cli', 'cron'] as const
const counts = [50, 100, 200, 500] as const
type File = typeof files[number]
type Level = typeof levels[number]
type Component = typeof components[number]
type Count = typeof counts[number]
type LogResponse = { file: string; lines: string[] }
type Props = {
  connected: boolean; profile: string | null; profiles: ProfilesSnapshot | null; epoch: string | null
  onSelectProfile(name: string): Promise<unknown>
}
const scope = (profile: string) => ({ kind: 'profile' as const, profile })

export default function LogsView({ connected, profile, profiles, epoch, onSelectProfile }: Props) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [file, setFile] = React.useState<File>('agent')
  const [level, setLevel] = React.useState<Level>('ALL')
  const [component, setComponent] = React.useState<Component>('all')
  const [count, setCount] = React.useState<Count>(100)
  const [draft, setDraft] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [auto, setAuto] = React.useState(false)
  const [lines, setLines] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const generation = React.useRef(0)
  const output = React.useRef<HTMLDivElement>(null)

  const refresh = React.useCallback(async () => {
    const id = ++generation.current
    if (!connected || !profile) { setLines([]); return }
    setLoading(true)
    try {
      const response = await extensions.request<LogResponse>(scope(profile), 'logs.read', {
        file, level, component, lines: count, search,
      })
      if (generation.current === id) { setLines(response.lines); setError('') }
    } catch (cause) {
      if (generation.current === id) setError(describeError(cause, language))
    } finally {
      if (generation.current === id) setLoading(false)
    }
  }, [connected, profile, epoch, extensions, file, level, component, count, search, language])

  React.useEffect(() => {
    setLines([]); void refresh()
    return () => { generation.current++ }
  }, [refresh])
  React.useEffect(() => {
    if (!auto || !connected) return
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [auto, connected, refresh])
  React.useEffect(() => {
    const node = output.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lines])

  return <main className="logs-page">
    <header className="logs-heading"><div><p className="logs-kicker">HERMESS · OBSERVABILITY</p><h1>{zh ? '运行日志' : 'Logs'}</h1><p>{zh ? '按 Profile 查看 Hermes 日志，定位 Agent、工具和 Gateway 的执行过程。' : 'Inspect Hermes agent, tool, and Gateway activity by profile.'}</p></div><div className="logs-heading-actions"><label><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />{zh ? '自动刷新' : 'Auto refresh'}</label><button type="button" disabled={!connected || loading} onClick={() => void refresh()}>{loading ? (zh ? '读取中…' : 'Loading…') : (zh ? '刷新' : 'Refresh')}</button></div></header>
    <div className="logs-toolbar"><label>Profile <select value={profile || ''} disabled={!connected} onChange={event => { setError(''); void onSelectProfile(event.target.value).catch(cause => setError(describeError(cause, language))) }}>{(profiles?.profiles || []).map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label><label>{zh ? '文件' : 'File'} <select value={file} onChange={event => setFile(event.target.value as File)}>{files.map(value => <option key={value} value={value}>{value}.log</option>)}</select></label><label>{zh ? '级别' : 'Level'} <select value={level} onChange={event => setLevel(event.target.value as Level)}>{levels.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>{zh ? '组件' : 'Component'} <select value={component} onChange={event => setComponent(event.target.value as Component)}>{components.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>{zh ? '行数' : 'Lines'} <select value={count} onChange={event => setCount(Number(event.target.value) as Count)}>{counts.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
    <form className="logs-search" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()) }}><input aria-label={zh ? '搜索日志' : 'Search logs'} value={draft} maxLength={120} placeholder={zh ? '按文本搜索日志' : 'Search log text'} onChange={event => setDraft(event.target.value)} /><button type="submit">{zh ? '搜索' : 'Search'}</button>{search && <button type="button" onClick={() => { setDraft(''); setSearch('') }}>{zh ? '清除' : 'Clear'}</button>}</form>
    {error && <div className="logs-error" role="alert">{error}</div>}
    {!connected && <div className="logs-empty">{zh ? '请先启动本机 Gateway。' : 'Start the local Gateway first.'}</div>}
    {connected && <section className="logs-panel"><div className="logs-panel-head"><strong>{file}.log</strong><span>{zh ? `${lines.length} 行` : `${lines.length} lines`}{auto && <em>{zh ? ' · 实时' : ' · Live'}</em>}</span></div><div className="logs-output" ref={output} role="log" aria-live="off">{lines.length === 0 && !loading && <div className="logs-empty">{zh ? '没有匹配的日志' : 'No matching log lines'}</div>}{lines.map((line, index) => <div className={`logs-line ${classifyLogLine(line)}`} key={`${index}:${line}`}>{line}</div>)}</div></section>}
  </main>
}
