import React from 'react'
import type { MemoryProviderConfig, MemoryProviderOAuthStatus } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

export default function MemoryProviderSettings({ connected, profile }: { connected: boolean; profile: string | null }) {
  const { memory } = useDesktop()
  const language = useLanguage()
  const [provider, setProvider] = React.useState('honcho')
  const [config, setConfig] = React.useState<MemoryProviderConfig | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [oauth, setOauth] = React.useState<MemoryProviderOAuthStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const pollGeneration = React.useRef(0)
  const scope = React.useCallback(() => {
    if (!profile) throw new Error(language === 'zh-CN' ? '未选择 Profile' : 'No Profile selected')
    return { kind: 'profile' as const, profile }
  }, [profile, language])
  const load = React.useCallback(async () => {
    if (!connected || !profile) return
    setBusy(true)
    try {
      const next = await memory.providerConfig(scope(), provider)
      setConfig(next)
      setValues(Object.fromEntries(next.fields.map(field => [field.key, field.kind === 'secret' ? '' : field.value])))
      setStatus(language === 'zh-CN' ? '已读取记忆提供方声明配置' : 'Declared memory provider configuration loaded')
    } catch (error) { setConfig(null); setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }, [connected, profile, provider, memory, scope, language])
  React.useEffect(() => { void load(); return () => { ++pollGeneration.current } }, [load])
  const save = async () => {
    if (!config) return
    const changed = Object.fromEntries(config.fields.flatMap(field => {
      const value = values[field.key] ?? ''
      if (field.kind === 'secret') return value.trim() ? [[field.key, value]] : []
      if (value === field.value) return []
      if (field.kind === 'bool') return [[field.key, value === 'true']]
      if (field.kind === 'number') return [[field.key, Number(value)]]
      if (field.kind === 'json') {
        try { return [[field.key, JSON.parse(value)]] } catch { setStatus(language === 'zh-CN' ? `${field.label} 不是有效 JSON` : `${field.label} is not valid JSON`); return [] }
      }
      return [[field.key, value]]
    }))
    if (!Object.keys(changed).length) { setStatus(language === 'zh-CN' ? '没有需要保存的改动' : 'No changes to save'); return }
    setBusy(true)
    try { await memory.saveProviderConfig(scope(), provider, changed); await load(); setStatus(language === 'zh-CN' ? '记忆提供方配置已保存并重新读取' : 'Memory provider configuration saved and reloaded') }
    catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }
  const pollOAuth = async (generation: number, remaining = 30) => {
    if (generation !== pollGeneration.current || remaining <= 0) { if (remaining <= 0) setStatus(language === 'zh-CN' ? 'OAuth 等待超时，可重新连接' : 'OAuth timed out; reconnect to try again'); return }
    try {
      const next = await memory.oauthStatus(scope(), provider)
      if (generation !== pollGeneration.current) return
      setOauth(next)
      if (next.state === 'pending') window.setTimeout(() => void pollOAuth(generation, remaining - 1), 2000)
      else setStatus(next.connected ? (language === 'zh-CN' ? 'OAuth 已连接' : 'OAuth connected') : next.detail)
    } catch (error) { if (generation === pollGeneration.current) setStatus(describeError(error, language)) }
  }
  const startOAuth = async () => {
    setBusy(true)
    const generation = ++pollGeneration.current
    try { const next = await memory.startOAuth(scope(), provider); setOauth(next); setStatus(next.detail || (language === 'zh-CN' ? '正在等待 OAuth 授权' : 'Waiting for OAuth')); if (next.state === 'pending') window.setTimeout(() => void pollOAuth(generation), 2000) }
    catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }
  if (!connected || !profile) return null
  return <section className="memory-provider-settings">
    <div className="row"><div><h2>{language === 'zh-CN' ? '外部记忆提供方' : 'External memory provider'}</h2><p>{language === 'zh-CN' ? '字段由锁定运行时声明；密钥只提交改动，不回填明文。' : 'Fields are declared by the locked runtime. Secret changes are submitted but never filled back in.'}</p></div><button disabled={busy} onClick={() => void load()}>{language === 'zh-CN' ? '重新读取' : 'Reload'}</button></div>
    <label>{language === 'zh-CN' ? '提供方' : 'Provider'}<select value={provider} disabled={busy} onChange={event => setProvider(event.target.value)}><option value="honcho">Honcho</option><option value="mem0">Mem0</option><option value="local">Local</option></select></label>
    {config && <div className="memory-provider-fields">{config.fields.map(field => <label key={field.key}><span>{field.label}{field.is_set && field.kind === 'secret' ? (language === 'zh-CN' ? '（已配置）' : ' (configured)') : ''}</span><small>{field.description}</small>{field.kind === 'select'
      ? <select value={values[field.key] || ''} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : field.kind === 'bool' ? <select value={values[field.key] || 'false'} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}><option value="true">true</option><option value="false">false</option></select>
      : field.kind === 'json' ? <textarea rows={4} value={values[field.key] || ''} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} />
      : <input type={field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={field.placeholder} value={values[field.key] || ''} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} />}</label>)}</div>}
    <div className="actions"><button disabled={busy || !config} onClick={() => void save()}>{language === 'zh-CN' ? '保存提供方配置' : 'Save provider configuration'}</button><button disabled={busy} onClick={() => void startOAuth()}>{language === 'zh-CN' ? '连接 OAuth' : 'Connect OAuth'}</button>{oauth?.state === 'pending' && <button onClick={() => { ++pollGeneration.current; setOauth(null); setStatus(language === 'zh-CN' ? '已取消等待 OAuth' : 'OAuth polling cancelled') }}>{language === 'zh-CN' ? '取消等待' : 'Cancel'}</button>}</div>
    <p role="status">{status}</p>
  </section>
}
