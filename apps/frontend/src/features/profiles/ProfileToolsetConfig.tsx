import React from 'react'
import type { ProfileToolset } from '@hermess/contracts'
import { describeError } from '../../app/desktopErrors'
import { visibleToolsetProviders } from './toolsetProviderModel'
import './profile-toolset-config.css'

type EnvField = { key: string; prompt: string; url?: string | null; is_set: boolean }
type Provider = { name: string; badge?: string; tag?: string; status?: string; env_vars: EnvField[]; is_active: boolean; post_setup?: string | null; requires_nous_auth?: boolean; managed_nous_feature?: string | null; web_backend?: string; capabilities?: Array<'search' | 'extract'> }
type Config = { name: string; has_category: boolean; providers: Provider[]; active_provider: string | null; active_search_backend?: string | null; active_extract_backend?: string | null; search_via_nous?: boolean; extract_via_nous?: boolean }
type SetupRun = { id: string; subject: string; running: boolean; exit_code: number | null; error: string | null; lines: string[] }
type Props = {
  toolset: ProfileToolset
  language: 'zh-CN' | 'en-US'
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  onClose: () => void
  onChanged: () => Promise<void>
}

export default function ProfileToolsetConfig({ toolset, language, request, onClose, onChanged }: Props) {
  const zh = language === 'zh-CN'
  const [config, setConfig] = React.useState<Config | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [setupRun, setSetupRun] = React.useState<SetupRun | null>(null)

  const load = React.useCallback(async () => {
    const value = await request<Config>('toolsets.config', { name: toolset.name })
    setConfig(value)
  }, [request, toolset.name])
  React.useEffect(() => {
    let cancelled = false
    void request<Config>('toolsets.config', { name: toolset.name }).then(value => {
      if (!cancelled) setConfig(value)
    }).catch(reason => {
      if (!cancelled) setError(describeError(reason, language))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [request, toolset.name, language])
  React.useEffect(() => {
    let cancelled = false
    void request<SetupRun | null>('systemActions.status', { action: 'toolset-post-setup', name: toolset.name }).then(value => {
      if (!cancelled && value) setSetupRun(value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [request, toolset.name])
  React.useEffect(() => {
    if (!setupRun?.running) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const value = await request<SetupRun>('systemActions.status', { action: 'toolset-post-setup', name: toolset.name, id: setupRun.id })
        if (cancelled) return
        setSetupRun(value)
        if (value.running) timer = setTimeout(() => void poll(), 1200)
        else void Promise.all([load(), onChanged()]).catch(reason => { if (!cancelled) setError(describeError(reason, language)) })
      } catch (reason) {
        if (cancelled) return
        setError(describeError(reason, language))
        timer = setTimeout(() => void poll(), 3000)
      }
    }
    timer = setTimeout(() => void poll(), 1200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [setupRun?.id, setupRun?.running, request, toolset.name, language, load])

  async function selectProvider(provider: Provider, capability?: 'search' | 'extract') {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await request<{ needs_nous_auth?: boolean }>('toolsets.provider', { name: toolset.name, provider: provider.name, ...(capability ? { capability } : {}) })
      await load()
      await onChanged()
      setMessage(result.needs_nous_auth
        ? (zh ? '已保存选择；该提供方仍需在对应工具中完成认证后才能使用。' : 'Selection saved. Complete authentication in the provider tool before use.')
        : (zh ? '提供方已保存。' : 'Provider saved.'))
    } catch (reason) {
      setError(describeError(reason, language))
    } finally {
      setBusy(false)
    }
  }

  async function toggle() {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request('toolsets.toggle', { name: toolset.name, enabled: !toolset.enabled })
      await onChanged()
      setMessage(toolset.enabled ? (zh ? '工具集已关闭。' : 'Toolset disabled.') : (zh ? '工具集已启用。' : 'Toolset enabled.'))
    } catch (reason) {
      setError(describeError(reason, language))
    } finally {
      setBusy(false)
    }
  }

  async function saveKeys(provider: Provider) {
    const env = Object.fromEntries(provider.env_vars.map(field => [field.key, drafts[field.key]?.trim() || '']).filter(([, value]) => value))
    if (busy || Object.keys(env).length === 0) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request('toolsets.env', { name: toolset.name, env })
      setDrafts(current => { const next = { ...current }; for (const key of Object.keys(env)) delete next[key]; return next })
      await load()
      await onChanged()
      setMessage(zh ? '密钥已保存。' : 'Keys saved.')
    } catch (reason) {
      setError(describeError(reason, language))
    } finally {
      setBusy(false)
    }
  }

  async function startSetup(provider: Provider) {
    if (busy || setupRun?.running || !provider.post_setup) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setSetupRun(await request<SetupRun>('systemActions.start', { action: 'toolset-post-setup', name: toolset.name, key: provider.post_setup }))
    } catch (reason) {
      setError(describeError(reason, language))
    } finally {
      setBusy(false)
    }
  }

  const providers = visibleToolsetProviders(config?.providers || [])

  return <section className="profile-toolset-config" aria-label={zh ? `${toolset.label || toolset.name} 配置` : `${toolset.label || toolset.name} configuration`}>
    <div className="profile-toolset-config-heading"><div><h4>{toolset.label || toolset.name}</h4><p>{toolset.description}</p><button type="button" disabled={busy} onClick={() => void toggle()}>{busy ? (zh ? '处理中…' : 'Working…') : toolset.enabled ? (zh ? '关闭工具集' : 'Disable toolset') : (zh ? '启用工具集' : 'Enable toolset')}</button></div><button type="button" disabled={busy} onClick={onClose}>{zh ? '关闭' : 'Close'}</button></div>
    {loading && <p>{zh ? '读取提供方配置中…' : 'Loading provider settings…'}</p>}
    {error && <p role="alert" className="profile-skill-action-error">{error}</p>}
    {message && <p role="status" className="profile-toolset-message">{message}</p>}
    {config && (!config.has_category ? <p>{zh ? '此工具集没有需要配置的提供方。' : 'This toolset has no provider settings.'}</p>
      : providers.length === 0 ? <p>{zh ? '此安装没有可用的提供方。' : 'No providers are available in this install.'}</p>
        : <div className="profile-toolset-providers">{providers.map(provider => <article key={provider.name}>
          <div className="profile-toolset-provider-heading"><div><strong>{provider.name}</strong>{provider.badge && <span>{provider.badge}</span>}{provider.tag && <p>{provider.tag}</p>}{provider.status && <small>{provider.status}</small>}</div>
            {toolset.name === 'web' ? <div className="profile-toolset-capabilities">{provider.capabilities?.map(capability => {
              const active = capability === 'search' ? config.active_search_backend : config.active_extract_backend
              const managed = capability === 'search' ? config.search_via_nous : config.extract_via_nous
              const selected = active === provider.web_backend && Boolean(managed) === Boolean(provider.managed_nous_feature)
              return selected ? <span key={capability}>{capability === 'search' ? (zh ? '搜索已选' : 'Search selected') : (zh ? '提取已选' : 'Extract selected')}</span>
                : <button key={capability} type="button" disabled={busy} onClick={() => void selectProvider(provider, capability)}>{capability === 'search' ? (zh ? '用于搜索' : 'Use for search') : (zh ? '用于提取' : 'Use for extract')}</button>
            })}</div> : config.active_provider === provider.name ? <span>{zh ? '已选择' : 'Selected'}</span> : <button type="button" disabled={busy} onClick={() => void selectProvider(provider)}>{zh ? '选择' : 'Select'}</button>}</div>
          {provider.env_vars.length > 0 && <div className="profile-toolset-env">{provider.env_vars.map(field => <label key={field.key}>{field.key} {field.is_set && <span>{zh ? '已保存' : 'Saved'}</span>}<input type="password" autoComplete="off" value={drafts[field.key] || ''} placeholder={field.is_set ? (zh ? '留空保持原值' : 'Leave blank to keep') : field.prompt} onChange={event => setDrafts(current => ({ ...current, [field.key]: event.target.value }))} /></label>)}<button type="button" disabled={busy || !provider.env_vars.some(field => drafts[field.key]?.trim())} onClick={() => void saveKeys(provider)}>{zh ? '保存密钥' : 'Save keys'}</button></div>}
          {provider.post_setup && <div className="profile-toolset-setup"><p>{zh ? '此提供方需要安装组件。' : 'This provider needs setup.'}</p><button type="button" disabled={busy || Boolean(setupRun?.running)} onClick={() => void startSetup(provider)}>{setupRun?.running ? (zh ? '安装中…' : 'Installing…') : (zh ? '安装组件' : 'Run setup')}</button></div>}
        </article>)}</div>)}
    {setupRun && <div className="profile-toolset-setup-result" role="status"><strong>{setupRun.running ? (zh ? '安装进行中' : 'Setup running') : setupRun.exit_code === 0 && !setupRun.error ? (zh ? '安装完成' : 'Setup complete') : (zh ? '安装失败' : 'Setup failed')}</strong>{setupRun.lines.length > 0 && <pre>{setupRun.lines.join('\n')}</pre>}</div>}
  </section>
}
