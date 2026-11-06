import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { displayedTools, externalKeyUrl } from './envKeyPresentation'
import './env-keys.css'

type EnvVarInfo = {
  is_set: boolean; redacted_value: string | null; description: string; url: string | null
  category: string; is_password: boolean; tools: string[]; advanced: boolean
  channel_managed?: boolean; custom?: boolean; provider?: string; provider_label?: string
}
type Vars = Record<string, EnvVarInfo>
type Props = {
  connected: boolean; profile: string | null; profiles: ProfilesSnapshot | null; epoch: string | null
  onSelectProfile(name: string): Promise<unknown>; onOpenModels(): void; onOpenChannels(): void
}
const scope = (profile: string) => ({ kind: 'profile' as const, profile })
const categories = ['provider', 'tool', 'skill', 'messaging', 'setting', 'custom'] as const
const categoryLabels: Record<string, [string, string]> = {
  provider: ['模型提供商', 'Model providers'], tool: ['工具', 'Tools'],
  skill: ['技能', 'Skills'],
  messaging: ['网关', 'Gateway'], setting: ['设置', 'Settings'], custom: ['自定义', 'Custom'],
}
const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/

export default function EnvKeysView({ connected, profile, profiles, epoch, onSelectProfile, onOpenModels, onOpenChannels }: Props) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [vars, setVars] = React.useState<Vars | null>(null)
  const [filter, setFilter] = React.useState('')
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [showUnset, setShowUnset] = React.useState(false)
  const [edits, setEdits] = React.useState<Record<string, string>>({})
  const [revealed, setRevealed] = React.useState<Record<string, string>>({})
  const [customKey, setCustomKey] = React.useState('')
  const [customValue, setCustomValue] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const generation = React.useRef(0)
  const currentProfile = React.useRef(profile)
  currentProfile.current = profile
  const timers = React.useRef(new Map<string, number>())

  const cancelRevealTimers = React.useCallback(() => {
    for (const timer of timers.current.values()) window.clearTimeout(timer)
    timers.current.clear()
  }, [])
  const clearReveals = React.useCallback(() => {
    cancelRevealTimers()
    setRevealed({})
  }, [cancelRevealTimers])
  const refresh = React.useCallback(async () => {
    const id = ++generation.current
    if (!connected || !profile) { setVars(null); setLoading(false); return }
    setLoading(true)
    try {
      const result = await extensions.request<Vars>(scope(profile), 'envKeys.list')
      if (generation.current === id) { setVars(result); setError('') }
    } catch (cause) {
      if (generation.current === id) setError(describeError(cause, language))
    } finally {
      if (generation.current === id) setLoading(false)
    }
  }, [connected, profile, epoch, extensions, language])

  React.useEffect(() => {
    setVars(null); setEdits({}); setCustomKey(''); setCustomValue(''); setNotice(''); clearReveals()
    void refresh()
    return () => { generation.current++; cancelRevealTimers() }
  }, [refresh, clearReveals, cancelRevealTimers])

  const run = async (operation: string, payload: Record<string, string>, success: string) => {
    if (!profile || busy) return false
    const targetProfile = profile
    setBusy(operation); setError(''); setNotice('')
    try {
      await extensions.request(scope(profile), operation, payload)
      if (currentProfile.current !== targetProfile) return false
      clearReveals()
      await refresh()
      setNotice(success)
      return true
    } catch (cause) { setError(describeError(cause, language)); return false }
    finally { setBusy('') }
  }
  const save = async (key: string) => {
    const value = edits[key]
    if (!value) return
    if (await run('envKeys.save', { key, value }, zh ? `${key} 已保存；部分服务可能需要重启。` : `${key} saved; some services may need a restart.`)) {
      setEdits(previous => { const next = { ...previous }; delete next[key]; return next })
    }
  }
  const remove = (key: string) => {
    if (!window.confirm(zh ? `删除 ${key}？相关模型配置中的同值凭据也会被清理。` : `Delete ${key}? Matching model credentials will also be cleared.`)) return
    void run('envKeys.delete', { key }, zh ? `${key} 已删除` : `${key} deleted`)
  }
  const reveal = async (key: string) => {
    if (revealed[key]) {
      const timer = timers.current.get(key)
      if (timer) window.clearTimeout(timer)
      timers.current.delete(key)
      setRevealed(previous => { const next = { ...previous }; delete next[key]; return next })
      return
    }
    if (!profile || busy) return
    const id = generation.current
    setBusy('envKeys.reveal'); setError('')
    try {
      const result = await extensions.request<{ key: string; value: string }>(scope(profile), 'envKeys.reveal', { key })
      if (generation.current !== id) return
      setRevealed(previous => ({ ...previous, [key]: result.value }))
      const previous = timers.current.get(key)
      if (previous) window.clearTimeout(previous)
      timers.current.set(key, window.setTimeout(() => {
        setRevealed(values => { const next = { ...values }; delete next[key]; return next })
        timers.current.delete(key)
      }, 30000))
    } catch (cause) { if (generation.current === id) setError(describeError(cause, language)) }
    finally { setBusy('') }
  }
  const addCustom = async (event: React.FormEvent) => {
    event.preventDefault()
    const key = customKey.trim()
    if (!validKey.test(key) || !customValue || vars?.[key]) return
    if (await run('envKeys.save', { key, value: customValue }, zh ? `${key} 已添加` : `${key} added`)) {
      setCustomKey(''); setCustomValue('')
    }
  }

  const entries = Object.entries(vars || {}).filter(([key, info]) => !info.channel_managed
    && (showAdvanced || !info.advanced || info.is_set || !!filter.trim())
    && (showUnset || info.is_set || !!filter.trim())
    && (!filter.trim() || `${key} ${info.description} ${info.provider_label || ''}`.toLowerCase().includes(filter.trim().toLowerCase())))
  const configured = Object.values(vars || {}).filter(info => info.is_set && !info.channel_managed).length

  return <main className="env-keys-page">
    <header className="env-keys-heading"><div><p className="env-keys-kicker">HERMESS · CREDENTIALS</p><h1>{zh ? '密钥与环境变量' : 'Keys and environment'}</h1><p>{zh ? '集中查看当前 Profile 的配置状态。列表只返回脱敏值。' : 'Manage credentials for the current profile. Lists contain masked values only.'}</p></div><button type="button" disabled={!connected || loading || !!busy} onClick={() => void refresh()}>{loading ? (zh ? '读取中…' : 'Loading…') : (zh ? '刷新' : 'Refresh')}</button></header>
    <div className="env-keys-toolbar"><label>Profile <select value={profile || ''} disabled={!connected || !!busy} onChange={event => { setError(''); void onSelectProfile(event.target.value).catch(cause => setError(describeError(cause, language))) }}>{(profiles?.profiles || []).map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label><input aria-label={zh ? '搜索变量' : 'Search keys'} value={filter} placeholder={zh ? '搜索名称或说明' : 'Search names or descriptions'} onChange={event => setFilter(event.target.value)} /><label className="env-keys-check"><input type="checkbox" checked={showUnset} onChange={event => setShowUnset(event.target.checked)} />{zh ? '显示未配置' : 'Show unset'}</label><label className="env-keys-check"><input type="checkbox" checked={showAdvanced} onChange={event => setShowAdvanced(event.target.checked)} />{zh ? '显示高级变量' : 'Show advanced'}</label>{vars && <span>{configured} {zh ? '项已配置' : 'configured'}</span>}</div>
    <div className="env-keys-related"><span>{zh ? 'OAuth 登录与模型连接在模型设置中管理；渠道专属凭据在渠道页管理。' : 'Manage OAuth and model connections in model settings, and channel credentials in Channels.'}</span><button type="button" onClick={onOpenModels}>{zh ? '模型设置' : 'Model settings'}</button><button type="button" onClick={onOpenChannels}>{zh ? '渠道' : 'Channels'}</button></div>
    {!connected && <div className="env-keys-empty">{zh ? '请先启动本机 Gateway。' : 'Start the local Gateway first.'}</div>}
    {error && <div className="env-keys-error" role="alert">{error}</div>}
    {notice && <div className="env-keys-notice" role="status">{notice}</div>}
    {connected && loading && !vars && <div className="env-keys-empty">{zh ? '正在读取变量…' : 'Loading keys…'}</div>}
    {connected && vars && categories.map(category => {
      const rows = entries.filter(([, info]) => info.category === category || (category === 'custom' && info.custom))
        .sort(([a, ai], [b, bi]) => Number(bi.is_set) - Number(ai.is_set) || a.localeCompare(b))
      if (!rows.length && category !== 'custom') return null
      return <section className="env-keys-section" key={category}><div className="env-keys-section-head"><h2>{categoryLabels[category][zh ? 0 : 1]}</h2><span>{rows.length}</span></div>{rows.map(([key, info]) => {
        const keyUrl = externalKeyUrl(info.url)
        const tools = displayedTools(info.tools)
        return <article className="env-keys-row" key={key}><div className="env-keys-row-main"><div className="env-keys-row-title"><strong>{key}</strong><span className={info.is_set ? 'set' : ''}>{info.is_set ? (zh ? '已配置' : 'Set') : (zh ? '未配置' : 'Unset')}</span>{info.provider_label && <small>{info.provider_label}</small>}</div>{info.description && <p>{info.description}</p>}{(keyUrl || tools.length > 0) && <div className="env-keys-row-meta">{keyUrl && <a href={keyUrl} target="_blank" rel="noreferrer">{zh ? '获取密钥 ↗' : 'Get key ↗'}</a>}{tools.map(tool => <span key={tool}>{tool}</span>)}</div>}{info.is_set && <code>{info.redacted_value || '••••••••'}</code>}</div><div className="env-keys-row-controls"><input type={info.is_password ? 'password' : 'text'} autoComplete="new-password" aria-label={`${key} ${zh ? '新值' : 'new value'}`} placeholder={info.is_set ? (zh ? '输入新值以替换' : 'Enter a replacement') : (zh ? '输入值' : 'Enter value')} value={edits[key] || ''} onChange={event => setEdits(previous => ({ ...previous, [key]: event.target.value }))} /><button type="button" disabled={!edits[key] || !!busy} onClick={() => void save(key)}>{zh ? '保存' : 'Save'}</button>{info.is_set && <><button type="button" disabled={!!busy} onClick={() => void reveal(key)}>{revealed[key] ? (zh ? '隐藏' : 'Hide') : (zh ? '显示' : 'Reveal')}</button><button type="button" className="env-keys-delete" disabled={!!busy} onClick={() => remove(key)}>{zh ? '删除' : 'Delete'}</button></>}</div>{revealed[key] && <div className="env-keys-revealed"><label>{zh ? '原值（30 秒后自动隐藏）' : 'Value (hidden after 30 seconds)'} <input value={revealed[key]} readOnly autoComplete="off" /></label></div>}</article>
      })}{category === 'custom' && <form className="env-keys-custom" onSubmit={event => void addCustom(event)}><h3>{zh ? '添加自定义变量' : 'Add a custom key'}</h3><input aria-label={zh ? '变量名' : 'Key name'} value={customKey} placeholder="MY_API_KEY" onChange={event => setCustomKey(event.target.value)} /><input type="password" autoComplete="new-password" aria-label={zh ? '变量值' : 'Key value'} value={customValue} placeholder={zh ? '变量值' : 'Value'} onChange={event => setCustomValue(event.target.value)} /><button type="submit" disabled={!validKey.test(customKey.trim()) || !customValue || !!busy || Boolean(vars[customKey.trim()])}>{zh ? '添加' : 'Add'}</button></form>}</section>
    })}
  </main>
}
