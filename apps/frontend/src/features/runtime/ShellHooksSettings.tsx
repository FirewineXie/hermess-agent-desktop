import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import './shell-hooks.css'

type Hook = { event: string; matcher: string | null; command: string | null; timeout: number | null
  allowed: boolean; approved_at?: string | null; executable?: boolean }
type HooksResponse = { hooks: Hook[]; valid_events: string[] }

export default function ShellHooksSettings({ connected, profile, language }: { connected: boolean; profile: string | null; language: 'zh-CN' | 'en-US' }) {
  const { extensions } = useDesktop()
  const zh = language === 'zh-CN'
  const [data, setData] = React.useState<HooksResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [event, setEvent] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [matcher, setMatcher] = React.useState('')
  const [timeout, setTimeoutValue] = React.useState('')
  const [approve, setApprove] = React.useState(true)
  const [formOpen, setFormOpen] = React.useState(false)
  const revision = React.useRef(0)

  const refresh = React.useCallback(async () => {
    const current = ++revision.current
    if (!connected || !profile) { setData(null); return }
    setLoading(true); setError('')
    try {
      const result = await extensions.request<HooksResponse>({ kind: 'profile', profile }, 'hooks.list', { profile })
      if (current !== revision.current) return
      setData(result)
      setEvent(value => result.valid_events.includes(value) ? value : result.valid_events[0] || '')
    } catch (cause) { if (current === revision.current) setError(describeError(cause, language)) }
    finally { if (current === revision.current) setLoading(false) }
  }, [connected, profile, extensions, language])
  React.useEffect(() => { void refresh(); return () => { ++revision.current } }, [refresh])

  const create = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault()
    if (!profile || !event || !command.trim() || busy) return
    const seconds = timeout.trim() ? Number(timeout) : null
    if (seconds !== null && (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)) {
      setError(zh ? '超时必须为 1–3600 秒的整数。' : 'Timeout must be an integer from 1 to 3600 seconds.')
      return
    }
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request({ kind: 'profile', profile }, 'hooks.create', {
        profile, event, command: command.trim(), matcher: matcher.trim() || null, timeout: seconds, approve,
      })
      setFormOpen(false); setCommand(''); setMatcher(''); setTimeoutValue(''); setApprove(true)
      await refresh()
      setNotice(zh ? 'Hook 已创建；从下一次会话或 Gateway 重启后生效。' : 'Hook created. It takes effect in the next session or after a Gateway restart.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const remove = async (hook: Hook) => {
    if (!profile || !hook.command || busy || !window.confirm(zh
      ? `删除 ${hook.event} 的 Hook？同事件、同命令的重复配置也会一起删除。`
      : `Delete this ${hook.event} hook? Duplicate entries with the same event and command will also be removed.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request({ kind: 'profile', profile }, 'hooks.delete', { profile, event: hook.event, command: hook.command })
      await refresh()
      setNotice(zh ? 'Hook 已删除，授权记录已撤销。' : 'Hook deleted and consent revoked.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  return <section className="settings-panel shell-hooks-settings">
    <div className="shell-hooks-heading"><div><h2>Shell Hooks</h2><p>{zh ? '按当前 Profile 配置事件脚本。授权后 Hook 可在本机执行命令。' : 'Configure event scripts for this Profile. Approved hooks can run commands on this device.'}</p></div>
      <div><button type="button" disabled={!connected || !profile || loading} onClick={() => void refresh()}>{zh ? '刷新' : 'Refresh'}</button>
        <button type="button" disabled={!connected || !profile || !data?.valid_events.length} onClick={() => setFormOpen(value => !value)}>{formOpen ? (zh ? '收起表单' : 'Close form') : (zh ? '新建 Hook' : 'New hook')}</button></div></div>
    {!connected && <p>{zh ? '请先启动本机运行时。' : 'Start the local runtime first.'}</p>}
    {loading && <p role="status">{zh ? '读取 Hooks 中…' : 'Loading hooks…'}</p>}
    {error && <p role="alert" className="shell-hooks-error">{error}</p>}
    {notice && <p role="status" className="shell-hooks-notice">{notice}</p>}
    {formOpen && data && <form className="shell-hooks-form" onSubmit={event => void create(event)}>
      <label>{zh ? '事件' : 'Event'}<select value={event} onChange={event => setEvent(event.target.value)}>{data.valid_events.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>{zh ? '命令或脚本路径' : 'Command or script path'}<input required maxLength={4096} value={command} onChange={event => setCommand(event.target.value)} /></label>
      <label>{zh ? '匹配条件（可选）' : 'Matcher (optional)'}<input maxLength={500} value={matcher} onChange={event => setMatcher(event.target.value)} /></label>
      <label>{zh ? '超时秒数（可选）' : 'Timeout seconds (optional)'}<input type="number" min="1" max="3600" step="1" value={timeout} onChange={event => setTimeoutValue(event.target.value)} /></label>
      <label className="shell-hooks-checkbox"><input type="checkbox" checked={approve} onChange={event => setApprove(event.target.checked)} />{zh ? '创建时授权执行' : 'Approve execution when created'}</label>
      <p>{zh ? '未授权的 Hook 会保留配置但不会执行。配置在下一次会话或 Gateway 重启后生效。' : 'Unapproved hooks remain configured but do not run. Changes take effect in the next session or after a Gateway restart.'}</p>
      <button type="submit" disabled={busy || !event || !command.trim()}>{busy ? (zh ? '创建中…' : 'Creating…') : (zh ? '创建 Hook' : 'Create hook')}</button>
    </form>}
    {data && !data.hooks.length && <p className="shell-hooks-empty">{zh ? '当前 Profile 尚未配置 Shell Hooks。' : 'No shell hooks are configured for this Profile.'}</p>}
    <div className="shell-hooks-list">{data?.hooks.map((hook, index) => <article key={`${hook.event}:${hook.command}:${index}`}>
      <div><strong>{hook.event}</strong>{hook.matcher && <span>{zh ? '匹配：' : 'Matcher: '}{hook.matcher}</span>}</div>
      <code>{hook.command || '—'}</code>
      <div className="shell-hooks-meta"><span>{hook.allowed ? (zh ? '已授权' : 'Approved') : (zh ? '未授权' : 'Not approved')}</span>
        {hook.executable === false && <span>{zh ? '不可执行' : 'Not executable'}</span>}
        {hook.timeout && <span>{hook.timeout}s</span>}</div>
      <button type="button" disabled={busy || !hook.command} onClick={() => void remove(hook)}>{zh ? '删除' : 'Delete'}</button>
    </article>)}</div>
  </section>
}
