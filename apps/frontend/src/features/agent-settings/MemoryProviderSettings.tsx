import React from 'react'
import type { MemoryProviderConfig, MemoryProviderSummary } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { configValuesEqual } from './memoryContextModel'

type Props = { profile: string; language: Language; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }

export default function MemoryProviderSettings({ profile, language, onDirtyChange, onBusyChange }: Props) {
  const { memory } = useDesktop()
  const zh = language === 'zh-CN'
  const [providers, setProviders] = React.useState<MemoryProviderSummary[]>([])
  const [provider, setProvider] = React.useState('')
  const [config, setConfig] = React.useState<MemoryProviderConfig | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [oauth, setOauth] = React.useState<'idle' | 'pending' | 'connected' | 'error'>('idle')
  const [oauthAvailable, setOauthAvailable] = React.useState(false)
  const generation = React.useRef(0)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const scope = React.useMemo(() => ({ kind: 'profile' as const, profile }), [profile])
  const dirty = Object.keys(drafts).length > 0
  const cancelPolling = React.useCallback(() => {
    ++generation.current
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  React.useEffect(() => () => { cancelPolling(); onDirtyChange(false); onBusyChange(false) }, [cancelPolling, onDirtyChange, onBusyChange])

  React.useEffect(() => {
    const current = ++generation.current
    void memory.providers(scope).then(result => {
      if (current !== generation.current) return
      setProviders(result.providers)
      setProvider(result.active && result.providers.some(row => row.name === result.active) ? result.active : result.providers[0]?.name || '')
    }).catch(error => { if (current === generation.current) setStatus(describeError(error, language)) })
    return () => { ++generation.current }
  }, [memory, scope, language])

  const load = React.useCallback(async (name: string) => {
    if (!name) return
    const current = ++generation.current
    setOauthAvailable(false)
    setBusy(true)
    setStatus('')
    try {
      const next = await memory.config(scope, name)
      if (current !== generation.current) return
      setConfig(next)
      setDrafts({})
      try {
        const currentStatus = await memory.oauthStatus(scope, name)
        if (current === generation.current) { setOauthAvailable(true); setOauth(currentStatus.state) }
      } catch { if (current === generation.current) setOauthAvailable(false) }
    } catch (error) {
      if (current === generation.current) { setConfig(null); setStatus(describeError(error, language)) }
    } finally { if (current === generation.current) setBusy(false) }
  }, [memory, scope, language])
  React.useEffect(() => { setConfig(null); setDrafts({}); if (provider) void load(provider) }, [provider, load])

  const selectProvider = (name: string) => {
    if (dirty && !window.confirm(zh ? '放弃尚未保存的提供方配置？' : 'Discard unsaved provider settings?')) return
    cancelPolling(); setOauth('idle'); setProvider(name)
  }
  const save = async () => {
    if (!provider || !config || !dirty) return
    const changed = Object.fromEntries(Object.entries(drafts).filter(([key, value]) => {
      const field = config.fields.find(item => item.key === key)
      return field && (field.kind === 'secret' ? value.trim().length > 0 : value !== field.value)
    }))
    if (!Object.keys(changed).length) { setDrafts({}); return }
    const invalidJson = Object.keys(changed).find(key => {
      if (config.fields.find(field => field.key === key)?.kind !== 'json') return false
      try { JSON.parse(changed[key]); return false } catch { return true }
    })
    if (invalidJson) { setStatus(zh ? `${invalidJson} 不是有效 JSON。` : `${invalidJson} is not valid JSON.`); return }
    const current = ++generation.current
    setBusy(true); setStatus('')
    try {
      await memory.save(scope, provider, changed)
      const next = await memory.config(scope, provider)
      if (current !== generation.current) return
      const matches = Object.entries(changed).every(([key, value]) => {
        const field = next.fields.find(item => item.key === key)
        if (!field) return false
        if (field.kind === 'secret') return field.is_set
        if (field.kind === 'json') {
          try { return configValuesEqual(JSON.parse(field.value), JSON.parse(value)) } catch { return false }
        }
        if (field.kind === 'number') return Number(field.value) === Number(value)
        return field.value === value
      })
      if (!matches) throw new Error(zh ? '保存后回读不一致。' : 'Saved values did not match the readback.')
      setConfig(next); setDrafts({}); setStatus(zh ? '已保存并回读确认。' : 'Saved and verified.')
    } catch (error) { if (current === generation.current) setStatus(describeError(error, language)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const poll = async (current: number, left: number) => {
    if (current !== generation.current) return
    if (left <= 0) { setOauth('error'); setStatus(zh ? '等待授权超时，可重新连接。' : 'Authorization timed out. Try again.'); return }
    try {
      const next = await memory.oauthStatus(scope, provider)
      if (current !== generation.current) return
      setOauth(next.state)
      if (next.state === 'pending') timer.current = setTimeout(() => void poll(current, left - 1), 2000)
      else setStatus(next.connected ? (zh ? '授权已连接。' : 'Authorization connected.') : (zh ? '授权未完成。' : 'Authorization did not complete.'))
    } catch (error) { if (current === generation.current) { setOauth('error'); setStatus(describeError(error, language)) } }
  }
  const start = async () => {
    cancelPolling()
    const current = generation.current
    setBusy(true); setStatus('')
    try {
      const next = await memory.oauthStart(scope, provider)
      if (current !== generation.current) return
      setOauth(next.state)
      if (next.state === 'pending') timer.current = setTimeout(() => void poll(current, 30), 2000)
      else setStatus(next.connected ? (zh ? '授权已连接。' : 'Authorization connected.') : (zh ? '此提供方未开始授权。' : 'Authorization did not start.'))
    } catch (error) { if (current === generation.current) { setOauth('error'); setStatus(describeError(error, language)) } }
    finally { if (current === generation.current) setBusy(false) }
  }
  return <section className="memory-settings-group">
    <div className="memory-settings-group-copy"><h3>{zh ? '外部记忆提供方' : 'External memory provider'}</h3><p>{zh ? '字段由当前运行时提供；密钥只提交新值。' : 'Fields come from the runtime; secret values are write only.'}</p></div>
    <div className="memory-provider-editor">
      <label>{zh ? '提供方' : 'Provider'}<select value={provider} disabled={busy} onChange={event => selectProvider(event.target.value)}>{providers.map(row => <option value={row.name} key={row.name}>{row.name} · {row.status}</option>)}</select></label>
      {!providers.length && <p>{zh ? '当前运行时没有发现记忆提供方。' : 'No memory providers were discovered.'}</p>}
      {config && config.fields.length === 0 && <p role="status">{zh ? '此提供方没有可在桌面端编辑的配置字段。' : 'This provider has no editable desktop configuration fields.'}</p>}
      {config?.fields.map(field => <label key={field.key}>{field.label}{field.kind === 'secret' && field.is_set ? (zh ? '（已配置）' : ' (configured)') : ''}
        <small>{field.description}</small>
        {field.kind === 'select' || field.kind === 'bool' ? <select value={drafts[field.key] ?? field.value} onChange={event => setDrafts(old => ({ ...old, [field.key]: event.target.value }))}>
          {(field.kind === 'bool' ? [{ value: 'true', label: zh ? '开启' : 'On' }, { value: 'false', label: zh ? '关闭' : 'Off' }] : field.options).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : field.kind === 'json' ? <textarea value={drafts[field.key] ?? field.value} onChange={event => setDrafts(old => ({ ...old, [field.key]: event.target.value }))} />
          : <input type={field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={field.placeholder} value={drafts[field.key] ?? field.value} onChange={event => setDrafts(old => ({ ...old, [field.key]: event.target.value }))} />}</label>)}
      {config && <div className="actions"><button type="button" disabled={busy || !dirty} onClick={() => void save()}>{zh ? '保存提供方配置' : 'Save provider settings'}</button>
        {oauthAvailable && <button type="button" disabled={busy || dirty} onClick={() => void start()}>{zh ? '连接 OAuth' : 'Connect OAuth'}</button>}
        {oauth === 'pending' && <button type="button" onClick={() => { cancelPolling(); setOauth('idle'); setStatus(zh ? '已停止等待；授权窗口可能仍在运行。' : 'Stopped waiting; the authorization window may still be open.') }}>{zh ? '取消等待' : 'Stop waiting'}</button>}</div>}
      {status && <p role="status">{status}</p>}
    </div>
  </section>
}
