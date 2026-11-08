import React from 'react'
import type { MemoryProviderConfig, MemoryProviderSummary } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { configValuesEqual } from './memoryContextModel'

type Props = { profile: string; language: Language; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }
type SetupRun = { id: string; subject: string; running: boolean; exit_code: number | null; error: string | null; lines: string[] }

export default function MemoryProviderSettings({ profile, language, onDirtyChange, onBusyChange }: Props) {
  const { memory, extensions } = useDesktop()
  const zh = language === 'zh-CN'
  const builtin = '__builtin__'
  const [providers, setProviders] = React.useState<MemoryProviderSummary[]>([])
  const [provider, setProvider] = React.useState(builtin)
  const [activeProvider, setActiveProvider] = React.useState('')
  const [config, setConfig] = React.useState<MemoryProviderConfig | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [oauth, setOauth] = React.useState<'idle' | 'pending' | 'connected' | 'error'>('idle')
  const [oauthAvailable, setOauthAvailable] = React.useState(false)
  const [setupRun, setSetupRun] = React.useState<SetupRun | null>(null)
  const generation = React.useRef(0)
  const providerGeneration = React.useRef(0)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const scope = React.useMemo(() => ({ kind: 'profile' as const, profile }), [profile])
  const dirty = Object.keys(drafts).length > 0
  const cancelPolling = React.useCallback(() => {
    ++generation.current
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy || Boolean(setupRun?.running)) }, [busy, setupRun?.running, onBusyChange])
  React.useEffect(() => () => { cancelPolling(); onDirtyChange(false); onBusyChange(false) }, [cancelPolling, onDirtyChange, onBusyChange])

  const loadProviders = React.useCallback(async () => {
    const current = ++providerGeneration.current
    try {
      const result = await memory.providers(scope)
      if (current !== providerGeneration.current) return
      setProviders(result.providers)
      setActiveProvider(result.active)
      setProvider(result.active && result.providers.some(row => row.name === result.active) ? result.active : builtin)
    } catch (error) {
      if (current === providerGeneration.current) setStatus(describeError(error, language))
    }
  }, [memory, scope, language])
  React.useEffect(() => {
    setProvider(builtin); setActiveProvider(''); setProviders([])
    void loadProviders()
    return () => { ++providerGeneration.current }
  }, [loadProviders])

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
  React.useEffect(() => {
    setConfig(null); setDrafts({})
    if (provider !== builtin) void load(provider)
    else { cancelPolling(); setOauthAvailable(false); setOauth('idle'); setBusy(false) }
  }, [provider, load, cancelPolling])

  React.useEffect(() => {
    setSetupRun(null)
    if (provider === builtin) return
    let cancelled = false
    void extensions.request<SetupRun | null>(scope, 'systemActions.status', {
      action: 'memory-provider-setup', name: provider,
    }).then(value => { if (!cancelled && value) setSetupRun(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [extensions, scope, provider])

  React.useEffect(() => {
    if (!setupRun?.running || provider === builtin) return
    let cancelled = false
    let setupTimer: ReturnType<typeof setTimeout>
    const pollSetup = async () => {
      try {
        const next = await extensions.request<SetupRun>(scope, 'systemActions.status', {
          action: 'memory-provider-setup', name: provider, id: setupRun.id,
        })
        if (cancelled) return
        if (next.running) {
          setSetupRun(next)
          setupTimer = setTimeout(() => void pollSetup(), 1200)
          return
        }
        const refreshed = await memory.providers(scope)
        if (cancelled) return
        setSetupRun(next)
        setProviders(refreshed.providers); setActiveProvider(refreshed.active)
        if (next.exit_code === 0 && !next.error) {
          setStatus(zh ? '依赖准备完成，已刷新提供方状态；若仍显示不可用，请重启 Hermes。' : 'Dependencies prepared and provider status refreshed. Restart Hermes if it remains unavailable.')
          if (refreshed.providers.find(row => row.name === provider)?.available) void load(provider)
        } else {
          setStatus(zh ? '依赖安装失败。请在运行时日志中查看该系统操作的脱敏结果后重试。' : 'Dependency setup failed. Check the sanitized system action result in runtime logs and try again.')
        }
      } catch (error) {
        if (cancelled) return
        setStatus(describeError(error, language))
        setupTimer = setTimeout(() => void pollSetup(), 3000)
      }
    }
    setupTimer = setTimeout(() => void pollSetup(), 1200)
    return () => { cancelled = true; clearTimeout(setupTimer) }
  }, [setupRun?.id, setupRun?.running, provider, builtin, extensions, scope, memory, load, zh, language])

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
  const activate = async () => {
    if (busy || dirty) return
    const target = provider === builtin ? '' : provider
    const current = ++generation.current
    setBusy(true); setStatus('')
    try {
      const result = await extensions.request<{ ok: boolean; active: string }>(scope,
        'memory.provider.activate', { provider: target })
      if (current !== generation.current) return
      if (!result.ok || result.active !== target) throw new Error(zh ? '运行时返回的活动提供方不一致。' : 'Runtime returned a different active provider.')
      const readback = await memory.providers(scope)
      if (current !== generation.current) return
      if (readback.active !== target) throw new Error(zh ? '切换后回读不一致。' : 'Provider did not match after readback.')
      setProviders(readback.providers); setActiveProvider(readback.active)
      setStatus(target ? (zh ? `已启用 ${target}。` : `${target} is now active.`) : (zh ? '已切回内置记忆。' : 'Built-in memory is now active.'))
    } catch (error) { if (current === generation.current) setStatus(describeError(error, language)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const setup = async () => {
    if (provider === builtin || busy || setupRun?.running) return
    setBusy(true); setStatus('')
    try {
      setSetupRun(await extensions.request<SetupRun>(scope, 'systemActions.start', {
        action: 'memory-provider-setup', name: provider, provider,
      }))
    } catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
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
  const selectedProvider = providers.find(row => row.name === provider)
  const setupRunning = Boolean(setupRun?.running)
  return <section className="memory-settings-group">
    <div className="memory-settings-group-copy"><h3>{zh ? '外部记忆提供方' : 'External memory provider'}</h3><p>{zh ? '字段由当前运行时提供；密钥只提交新值。' : 'Fields come from the runtime; secret values are write only.'}</p></div>
    <div className="memory-provider-editor">
      <label>{zh ? '提供方' : 'Provider'}<select value={provider} disabled={busy || setupRunning} onChange={event => selectProvider(event.target.value)}><option value={builtin}>{zh ? '内置记忆（MEMORY.md / USER.md）' : 'Built-in memory (MEMORY.md / USER.md)'}</option>{providers.map(row => <option value={row.name} key={row.name}>{row.name} · {row.status}</option>)}</select></label>
      <p role="status">{(provider === builtin ? !activeProvider : activeProvider === provider) ? (zh ? '当前正在使用' : 'Currently active') : (zh ? '当前未启用' : 'Not active')}</p>
      {!providers.length && <p>{zh ? '没有发现外部记忆提供方；仍可使用内置记忆。' : 'No external memory providers were discovered; built-in memory remains available.'}</p>}
      {provider === 'openviking' && <aside aria-label={zh ? '本地 embedding 安装提示' : 'Local embedding setup guidance'}>
        <p><strong>{zh ? '使用本地 embedding' : 'Use local embeddings'}</strong></p>
        <p>{zh ? '可以让当前 Profile 的 AI 帮你安装和配置 OpenViking 本地服务及 embedding 模型。安装需要联网；记忆抽取仍使用配置的语言模型，该模型可以是远程 API。' : 'Ask the AI in this profile to help install and configure the local OpenViking service and embedding model. Installation requires internet access. Memory extraction still uses the configured language model, which may be a remote API.'}</p>
        <p>{zh ? '可以复制下面这段话发给 AI：' : 'Copy this request into your chat with the AI:'}</p>
        <blockquote>{zh
          ? `请使用 Hermess Desktop 自带的 Hermes，为当前 Profile「${profile}」配置 OpenViking。运行 hermes memory setup openviking，选择 Personal Agent 和 Quick Local，安装本地服务及 embedding 模型。保留现有对话历史设置，不修改其他 Hermes 安装。完成后检查记忆提供方配置与本地服务状态；如果无法完成交互或安装，请说明具体阻碍，不要报告安装成功。`
          : `Use the Hermes bundled with Hermess Desktop to configure OpenViking for the current profile "${profile}". Run hermes memory setup openviking, choose Personal Agent and Quick Local, and install the local service and embedding model. Preserve conversation history settings and leave other Hermes installations untouched. Check the memory provider configuration and local service status afterward. If interaction or installation cannot be completed, explain the blocker instead of reporting success.`}</blockquote>
        <small>{zh ? '“安装所需依赖”只准备插件依赖，不代表已安装本地服务和 embedding 模型。' : '“Install required dependencies” only prepares plugin dependencies; it does not mean the local service and embedding model have been installed.'}</small>
      </aside>}
      <div className="actions"><button type="button" disabled={busy || setupRunning || dirty || selectedProvider?.available === false || (provider === builtin ? !activeProvider : activeProvider === provider)} onClick={() => void activate()}>{zh ? '设为活动提供方' : 'Set active'}</button>
        {provider !== builtin && selectedProvider?.available === false && <button type="button" disabled={busy || setupRunning} onClick={() => void setup()}>{setupRunning ? (zh ? '安装依赖中…' : 'Installing dependencies…') : (zh ? '安装所需依赖' : 'Install required dependencies')}</button>}</div>
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
