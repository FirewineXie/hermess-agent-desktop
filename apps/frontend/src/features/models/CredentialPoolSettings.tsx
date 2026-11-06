import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import './credential-pool.css'

type Entry = { index: number; id: string; label: string; auth_type: string; source: string
  priority: number; last_status: string | null; request_count: number; token_preview: string; has_refresh: boolean }
type Pool = { provider: string; entries: Entry[] }
type PoolResponse = { providers: Pool[] }

export default function CredentialPoolSettings({ connected, profile, language }: { connected: boolean; profile: string | null; language: 'zh-CN' | 'en-US' }) {
  const { extensions, models } = useDesktop()
  const zh = language === 'zh-CN'
  const [data, setData] = React.useState<PoolResponse | null>(null)
  const [suggestions, setSuggestions] = React.useState<string[]>([])
  const [provider, setProvider] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const revision = React.useRef(0)

  const refresh = React.useCallback(async () => {
    const current = ++revision.current
    if (!connected || !profile) { setData(null); return }
    setLoading(true); setError('')
    try {
      const result = await extensions.request<PoolResponse>({ kind: 'profile', profile }, 'credentials.pool.list', { profile })
      if (current === revision.current) setData(result)
    } catch (cause) { if (current === revision.current) setError(describeError(cause, language)) }
    finally { if (current === revision.current) setLoading(false) }
  }, [connected, profile, extensions, language])
  React.useEffect(() => { void refresh(); return () => { ++revision.current } }, [refresh])
  React.useEffect(() => {
    if (!connected || !profile) return
    let active = true
    void models.options({ kind: 'profile', profile }, { refresh: false })
      .then(result => { if (active) setSuggestions(result.providers.map(item => item.slug)) })
      .catch(() => { if (active) setSuggestions([]) })
    return () => { active = false }
  }, [connected, profile, models])

  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile || busy || !provider.trim() || !apiKey.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request({ kind: 'profile', profile }, 'credentials.pool.add', {
        profile, provider: provider.trim(), api_key: apiKey.trim(), label: label.trim(),
      })
      setApiKey(''); setLabel('')
      await refresh()
      setNotice(zh ? '凭据已加入当前 Profile 的凭据池。' : 'Credential added to this Profile’s pool.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const remove = async (pool: Pool, entry: Entry) => {
    if (!profile || busy || !window.confirm(zh
      ? `删除 ${pool.provider} 的「${entry.label}」？来源为 ${entry.source}，关联的外部凭据可能同时清理。`
      : `Remove “${entry.label}” from ${pool.provider}? Source: ${entry.source}. Related external credentials may also be cleaned up.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request({ kind: 'profile', profile }, 'credentials.pool.delete', {
        profile, provider: pool.provider, index: entry.index, entry_id: entry.id,
      })
      await refresh()
      setNotice(zh ? '凭据已删除。' : 'Credential removed.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  return <section className="settings-panel credential-pool-settings">
    <div className="credential-pool-heading"><div><h2>{zh ? '凭据池' : 'Credential pool'}</h2><p>{zh ? '为当前 Profile 的提供商添加多个 API Key；列表只显示脱敏信息。' : 'Add multiple API keys per provider for this Profile. The list shows redacted values only.'}</p></div>
      <button type="button" disabled={!connected || !profile || loading} onClick={() => void refresh()}>{zh ? '刷新' : 'Refresh'}</button></div>
    {!connected && <p>{zh ? '请先启动本机运行时。' : 'Start the local runtime first.'}</p>}
    {error && <p role="alert" className="credential-pool-error">{error}</p>}
    {notice && <p role="status" className="credential-pool-notice">{notice}</p>}
    {connected && profile && <form className="credential-pool-form" onSubmit={event => void add(event)}>
      <label>{zh ? '提供商 ID' : 'Provider ID'}<input required list="credential-pool-providers" maxLength={100} value={provider} onChange={event => setProvider(event.target.value)} placeholder="openrouter" /><datalist id="credential-pool-providers">{suggestions.map(item => <option key={item} value={item} />)}</datalist></label>
      <label>API Key<input required type="password" autoComplete="off" maxLength={16384} value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
      <label>{zh ? '标签（可选）' : 'Label (optional)'}<input maxLength={100} value={label} onChange={event => setLabel(event.target.value)} /></label>
      <button type="submit" disabled={busy || !provider.trim() || !apiKey.trim()}>{busy ? (zh ? '添加中…' : 'Adding…') : (zh ? '添加凭据' : 'Add credential')}</button>
    </form>}
    {loading && <p role="status">{zh ? '读取凭据池中…' : 'Loading credential pool…'}</p>}
    {data && !data.providers.length && <p className="credential-pool-empty">{zh ? '当前 Profile 没有凭据池条目。' : 'No pooled credentials for this Profile.'}</p>}
    <div className="credential-pool-list">{data?.providers.map(pool => <section key={pool.provider}><h3>{pool.provider} <small>{pool.entries.length}</small></h3>
      {pool.entries.map(entry => <article key={entry.id}><div><strong>{entry.label}</strong><small>{entry.source} · {entry.auth_type}{entry.last_status ? ` · ${entry.last_status}` : ''}</small></div>
        <code>{entry.token_preview || '••••'}</code><span>{zh ? '请求' : 'Requests'} {entry.request_count}</span>
        <button type="button" disabled={busy} onClick={() => void remove(pool, entry)}>{zh ? '删除' : 'Remove'}</button></article>)}</section>)}</div>
  </section>
}
