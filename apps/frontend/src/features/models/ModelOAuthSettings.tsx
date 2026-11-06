import React from 'react'
import type { ModelOAuthProvider, ModelOAuthStart, ProfileScope } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { modelOAuthExpiry, modelOAuthPollDelay, modelOAuthTerminalMessage } from './modelOAuthModel'
import './model-oauth.css'

type LoginState = {
  provider: ModelOAuthProvider
  start: ModelOAuthStart
  phase: 'polling' | 'approved' | 'error'
  error: string
  deadline: number
}

type ActiveSession = { scope: ProfileScope; sessionId: string; pending: boolean }

export default function ModelOAuthSettings({ profile, language, onBusyChange, openRequest, onRequestHandled, onProvidersChange }: {
  profile: string
  language: 'zh-CN' | 'en-US'
  onBusyChange: (busy: boolean) => void
  openRequest: { providerId: string; nonce: number } | null
  onRequestHandled: () => void
  onProvidersChange: (providers: ModelOAuthProvider[]) => void
}) {
  const { models } = useDesktop()
  const zh = language === 'zh-CN'
  const [providers, setProviders] = React.useState<ModelOAuthProvider[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const [login, setLogin] = React.useState<LoginState | null>(null)
  const [externalProvider, setExternalProvider] = React.useState<ModelOAuthProvider | null>(null)
  const [secondsLeft, setSecondsLeft] = React.useState(0)
  const request = React.useRef(0)
  const pollGeneration = React.useRef(0)
  const activeSession = React.useRef<ActiveSession | null>(null)
  const scope = React.useMemo<ProfileScope>(() => ({ kind: 'profile', profile }), [profile])

  const refresh = React.useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    setError('')
    try {
      const result = await models.oauthProviders(scope)
      if (current === request.current) {
        setProviders(result.providers)
        onProvidersChange(result.providers)
      }
    } catch (cause) {
      if (current === request.current) setError(describeError(cause, language))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [models, scope, language, onProvidersChange])

  React.useEffect(() => {
    setProviders(null)
    setLogin(null)
    setExternalProvider(null)
    setMessage('')
    setError('')
    void refresh()
    return () => {
      ++request.current
      ++pollGeneration.current
      const active = activeSession.current
      if (active?.pending && active.scope.profile === profile) {
        active.pending = false
        void models.oauthCancel(active.scope, active.sessionId).catch(() => {})
      }
    }
  }, [profile, refresh, models])

  React.useEffect(() => {
    onBusyChange(Boolean(busy))
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  React.useEffect(() => {
    if (!login || login.phase !== 'polling') return
    setSecondsLeft(Math.max(0, Math.ceil((login.deadline - Date.now()) / 1000)))
    const timer = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((login.deadline - Date.now()) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [login?.start.session_id, login?.phase])

  React.useEffect(() => {
    if (!login || login.phase !== 'polling') return
    const generation = ++pollGeneration.current
    let timer = 0
    const poll = async () => {
      try {
        const result = await models.oauthPoll(scope, login.provider.id, login.start.session_id)
        if (generation !== pollGeneration.current) return
        const terminal = modelOAuthTerminalMessage(result.status, result.error_message, zh)
        if (result.status === 'pending') {
          timer = window.setTimeout(poll, modelOAuthPollDelay(login.start.poll_interval))
          return
        }
        if (activeSession.current?.sessionId === login.start.session_id) activeSession.current.pending = false
        if (result.status === 'approved') {
          setMessage(terminal || '')
          setLogin(current => current ? { ...current, phase: 'approved', error: '' } : null)
          void refresh()
        } else {
          setLogin(current => current ? { ...current, phase: 'error', error: terminal || '' } : null)
        }
      } catch (cause) {
        if (generation !== pollGeneration.current) return
        setLogin(current => current ? { ...current, phase: 'error', error: describeError(cause, language) } : null)
      }
    }
    timer = window.setTimeout(poll, modelOAuthPollDelay(login.start.poll_interval))
    return () => { ++pollGeneration.current; window.clearTimeout(timer) }
  }, [login?.start.session_id, login?.phase, login?.provider.id, login?.start.poll_interval, models, scope, language, zh, refresh])

  React.useEffect(() => {
    if (login?.phase !== 'approved') return
    const timer = window.setTimeout(() => setLogin(null), 1200)
    return () => window.clearTimeout(timer)
  }, [login?.phase])

  async function start(provider: ModelOAuthProvider) {
    if (busy || provider.flow !== 'device_code') return
    setBusy(provider.id)
    setError('')
    setMessage('')
    setCopyState('idle')
    try {
      const result = await models.oauthStart(scope, provider.id)
      const active = activeSession.current
      if (active?.pending) {
        active.pending = false
        await models.oauthCancel(active.scope, active.sessionId).catch(() => {})
      }
      activeSession.current = { scope, sessionId: result.session_id, pending: true }
      setLogin({ provider, start: result, phase: 'polling', error: '', deadline: Date.now() + result.expires_in * 1000 })
    } catch (cause) {
      setError(describeError(cause, language))
    } finally { setBusy('') }
  }

  async function closeLogin() {
    const active = activeSession.current
    setLogin(null)
    ++pollGeneration.current
    if (!active?.pending) return
    active.pending = false
    setBusy('cancel')
    try { await models.oauthCancel(active.scope, active.sessionId) }
    catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy('') }
  }

  async function retry() {
    const provider = login?.provider
    await closeLogin()
    if (provider) await start(provider)
  }

  async function disconnect(provider: ModelOAuthProvider) {
    if (!provider.disconnectable || busy) return
    const accepted = window.confirm(zh
      ? `断开 ${provider.name}？保存的 OAuth 凭据会被移除，之后需要重新登录。`
      : `Disconnect ${provider.name}? Stored OAuth credentials will be removed and login will be required again.`)
    if (!accepted) return
    setBusy(provider.id)
    setError('')
    setMessage('')
    try {
      await models.oauthDisconnect(scope, provider.id)
      setMessage(zh ? `${provider.name} 已断开。` : `${provider.name} disconnected.`)
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy('') }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState('copied')
    } catch { setCopyState('failed') }
  }

  React.useEffect(() => {
    if (!openRequest || !providers) return
    const provider = providers.find(item => item.id === openRequest.providerId)
    onRequestHandled()
    setError('')
    setMessage('')
    setCopyState('idle')
    if (!provider) { setError(zh ? '未找到所选授权提供商，请刷新后重试。' : 'The selected authorization provider is unavailable. Refresh and try again.'); return }
    if (provider.status.logged_in) { setMessage(zh ? `${provider.name} 已连接。` : `${provider.name} is already connected.`); return }
    if (provider.flow === 'device_code') void start(provider)
    else setExternalProvider(provider)
  }, [openRequest?.nonce, providers])

  const connectedProviders = providers?.filter(provider => provider.status.logged_in) || []
  return <>
    {loading && !providers && <div className="model-oauth-inline-status" role="status">{zh ? '正在读取账户授权状态…' : 'Loading account authorization status…'}</div>}
    {error && <div className="model-oauth-inline-status error" role="alert">{error}<button type="button" disabled={loading || Boolean(busy)} onClick={() => void refresh()}>{zh ? '重试' : 'Retry'}</button></div>}
    {message && <div className="model-oauth-inline-status" role="status">{message}</div>}
    {connectedProviders.map(provider => {
      const expiry = modelOAuthExpiry(provider.status.expires_at, zh)
      return <article key={provider.id} className="provider-card model-oauth-provider-card">
        <span className="saved-badge">{zh ? '账户已连接' : 'Account connected'}</span>
        <div className="provider-card-heading"><strong>{provider.name}</strong><div className="provider-card-actions">{provider.docs_url && <a href={provider.docs_url} target="_blank" rel="noopener noreferrer">{zh ? '文档' : 'Docs'}</a>}{provider.disconnectable && <button type="button" disabled={Boolean(busy)} onClick={() => void disconnect(provider)}>{busy === provider.id ? (zh ? '断开中…' : 'Disconnecting…') : (zh ? '断开' : 'Disconnect')}</button>}</div></div>
        <p>{provider.status.token_preview ? `token ${provider.status.token_preview}` : (zh ? 'OAuth 凭据已保存在当前 Profile。' : 'OAuth credentials are saved for this Profile.')}{provider.status.source_label ? ` · ${provider.status.source_label}` : ''}</p>
        <div className="model-oauth-card-meta"><span>{provider.flow === 'device_code' ? (zh ? '设备码授权' : 'Device-code authorization') : (zh ? '外部授权' : 'External authorization')}</span>{expiry && <span>{expiry}</span>}</div>
        {provider.status.error && <p className="model-oauth-error">{provider.status.error}</p>}
      </article>
    })}
    {externalProvider && <div className="model-oauth-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setExternalProvider(null) }}><div className="model-oauth-dialog" role="dialog" aria-modal="true" aria-labelledby="model-oauth-external-title">
      <div className="model-oauth-dialog-head"><div><h3 id="model-oauth-external-title">{zh ? `授权 ${externalProvider.name}` : `Authorize ${externalProvider.name}`}</h3><small>{zh ? '此提供商由外部 CLI 完成账户授权。' : 'This provider completes account authorization in its external CLI.'}</small></div><button type="button" disabled={Boolean(busy)} aria-label={zh ? '关闭' : 'Close'} onClick={() => setExternalProvider(null)}>×</button></div>
      {externalProvider.cli_command && <div className="model-oauth-command model-oauth-command-block"><code>{externalProvider.cli_command}</code><button type="button" onClick={() => void copy(externalProvider.cli_command || '')}>{copyState === 'copied' ? (zh ? '已复制' : 'Copied') : (zh ? '复制命令' : 'Copy')}</button></div>}
      {externalProvider.disconnect_hint && <p>{externalProvider.disconnect_hint}</p>}
      {copyState === 'failed' && <p className="model-oauth-error" role="alert">{zh ? '复制失败，请手动复制命令。' : 'Copy failed. Copy the command manually.'}</p>}
      <div className="model-oauth-dialog-actions">{externalProvider.docs_url && <a href={externalProvider.docs_url} target="_blank" rel="noopener noreferrer">{zh ? '查看文档' : 'Open docs'}</a>}<button type="button" onClick={() => setExternalProvider(null)}>{zh ? '关闭' : 'Close'}</button><button type="button" disabled={loading} onClick={() => { setExternalProvider(null); void refresh() }}>{zh ? '我已完成，刷新状态' : 'Completed, refresh status'}</button></div>
    </div></div>}
    {login && <div className="model-oauth-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) void closeLogin() }}><div className="model-oauth-dialog" role="dialog" aria-modal="true" aria-labelledby="model-oauth-dialog-title">
      <div className="model-oauth-dialog-head"><div><h3 id="model-oauth-dialog-title">{zh ? `登录 ${login.provider.name}` : `Login to ${login.provider.name}`}</h3>{login.phase === 'polling' && <small>{secondsLeft > 0 ? (zh ? `会话约 ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')} 后过期` : `Session expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`) : (zh ? '正在等待服务器最终状态' : 'Waiting for the server’s final status')}</small>}</div><button type="button" disabled={Boolean(busy)} aria-label={zh ? '关闭' : 'Close'} onClick={() => void closeLogin()}>×</button></div>
      {login.phase === 'polling' && <><p>{zh ? '在提供商页面输入以下设备码，然后返回此窗口等待完成。' : 'Enter this device code on the provider page, then return here and wait for completion.'}</p><div className="model-oauth-device-code"><code>{login.start.user_code}</code><button type="button" onClick={() => void copy(login.start.user_code)}>{copyState === 'copied' ? (zh ? '已复制' : 'Copied') : (zh ? '复制代码' : 'Copy code')}</button></div><a className="model-oauth-verification" href={login.start.verification_url} target="_blank" rel="noopener noreferrer">{zh ? '打开验证页面 ↗' : 'Open verification page ↗'}</a><p className="model-oauth-waiting">{zh ? '正在等待授权结果…' : 'Waiting for authorization…'}</p></>}
      {login.phase === 'approved' && <p className="model-oauth-approved">{zh ? '登录成功，正在刷新状态…' : 'Login completed. Refreshing status…'}</p>}
      {login.phase === 'error' && <><p className="model-oauth-error" role="alert">{login.error}</p><div className="model-oauth-dialog-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void closeLogin()}>{zh ? '关闭' : 'Close'}</button><button type="button" disabled={Boolean(busy)} onClick={() => void retry()}>{zh ? '重试' : 'Retry'}</button></div></>}
    </div></div>}
  </>
}
