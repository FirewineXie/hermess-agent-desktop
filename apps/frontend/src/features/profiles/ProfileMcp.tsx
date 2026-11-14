import React from 'react'
import type { McpOAuthCancelResult, McpOAuthFlow } from '@hermess/contracts'
import type { McpServer, McpSetupDraft } from '../extensions/model'
import type { labels } from '../extensions/labels'
import { isMcpOAuthTerminal, mcpOAuthPollDecision, shouldCancelMcpOAuthOnCleanup } from './mcpOAuthModel'

type T = ReturnType<typeof labels>
type Props = {
  servers: McpServer[]; busy: boolean; t: T;
  prefill?: McpSetupDraft
  onPrefillApplied?: () => void
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  cancelOAuth: (flowId: string) => Promise<McpOAuthCancelResult>
  run: (operation: string, payload?: Record<string, unknown>, after?: 'mcp') => Promise<boolean>
  onMessage: (message: string) => void
}

export default function ProfileMcp({ servers, busy, t, prefill, onPrefillApplied, request, cancelOAuth, run, onMessage }: Props) {
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [editUrl, setEditUrl] = React.useState('')
  const [editCommand, setEditCommand] = React.useState('')
  const [editArgs, setEditArgs] = React.useState('')
  const [name, setName] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [args, setArgs] = React.useState('')
  const [env, setEnv] = React.useState('')
  const [auth, setAuth] = React.useState('none')
  const [token, setToken] = React.useState('')
  const [catalogDraft, setCatalogDraft] = React.useState<McpSetupDraft | null>(null)
  const [testBusy, setTestBusy] = React.useState('')
  const [testResults, setTestResults] = React.useState<Record<string, { ok: boolean; tools: Array<{ name: string }>; error?: string }>>({})
  const [authFlow, setAuthFlow] = React.useState<McpOAuthFlow | null>(null)
  const [needsAuth, setNeedsAuth] = React.useState<ReadonlySet<string>>(new Set())
  const [cancelBusy, setCancelBusy] = React.useState(false)
  const pollGeneration = React.useRef(0)
  const pollTimer = React.useRef<number | null>(null)
  const cleanupTimers = React.useRef(new Map<string, number>())
  const cancelledFlows = React.useRef(new Set<string>())
  const requestRef = React.useRef(request)
  const cancelRef = React.useRef(cancelOAuth)
  const messageRef = React.useRef(onMessage)
  const labelsRef = React.useRef(t)
  requestRef.current = request
  cancelRef.current = cancelOAuth
  messageRef.current = onMessage
  labelsRef.current = t

  React.useEffect(() => {
    if (!prefill) return
    const option = prefill.option
    setName(prefill.name)
    setUrl(option?.transport === 'http' ? option.url : '')
    setCommand(option?.transport === 'stdio' ? option.command : '')
    setArgs(option?.transport === 'stdio' ? option.args.join('\n') : '')
    setEnv(option?.transport === 'stdio' ? option.env_keys.map(key => `${key}=`).join('\n') : '')
    setAuth('none')
    setToken('')
    setCatalogDraft(prefill)
    setEditing(null)
    setAdding(true)
    console.info('[mcp-setup] form opened', { operation: prefill.operation, transport: option?.transport })
    onPrefillApplied?.()
  }, [prefill, onPrefillApplied])

  const approvedFlow = authFlow?.status === 'approved' ? authFlow.flow_id : null
  React.useEffect(() => {
    let active = true
    void requestRef.current<{ needs_auth: string[] }>('mcp.status')
      .then(value => { if (active) setNeedsAuth(new Set(value.needs_auth)) })
      .catch(() => { if (active) setNeedsAuth(new Set()) })
    return () => { active = false }
  }, [servers, approvedFlow])

  React.useEffect(() => {
    if (!authFlow || isMcpOAuthTerminal(authFlow.status)) return
    const flowId = authFlow.flow_id
    const pendingCleanup = cleanupTimers.current.get(flowId)
    if (pendingCleanup !== undefined) {
      window.clearTimeout(pendingCleanup)
      cleanupTimers.current.delete(flowId)
    }
    const generation = ++pollGeneration.current
    let failures = 0
    let settled = false
    const schedule = () => {
      pollTimer.current = window.setTimeout(() => void poll(), 2000)
    }
    const poll = async () => {
      try {
        const value = await requestRef.current<McpOAuthFlow>('mcp.auth.status', { flow_id: flowId })
        if (pollGeneration.current !== generation) return
        const decision = mcpOAuthPollDecision(failures, value)
        failures = decision.failures
        setAuthFlow(value)
        if (decision.terminal) {
          settled = true
          messageRef.current(value.status === 'approved' ? labelsRef.current('authDone') : value.error || labelsRef.current('failed'))
          return
        }
        schedule()
      } catch {
        if (pollGeneration.current !== generation) return
        const decision = mcpOAuthPollDecision(failures)
        failures = decision.failures
        if (decision.terminal) {
          settled = true
          setAuthFlow(current => current?.flow_id === flowId ? { ...current, status: 'error', error: null } : current)
          messageRef.current(labelsRef.current('authPollFailed'))
          return
        }
        schedule()
      }
    }
    schedule()
    return () => {
      ++pollGeneration.current
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
      if (settled || !shouldCancelMcpOAuthOnCleanup(authFlow, cancelledFlows.current.has(flowId))) return
      const timer = window.setTimeout(() => {
        cleanupTimers.current.delete(flowId)
        if (!shouldCancelMcpOAuthOnCleanup(authFlow, cancelledFlows.current.has(flowId))) return
        cancelledFlows.current.add(flowId)
        void cancelRef.current(flowId).catch(() => {})
      }, 0)
      cleanupTimers.current.set(flowId, timer)
    }
  }, [authFlow?.flow_id])

  async function cancelAuthorization() {
    if (!authFlow || isMcpOAuthTerminal(authFlow.status) || cancelBusy) return
    setCancelBusy(true)
    try {
      await cancelOAuth(authFlow.flow_id)
      cancelledFlows.current.add(authFlow.flow_id)
      ++pollGeneration.current
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
      setAuthFlow({ ...authFlow, status: 'cancelled', error: null })
      onMessage(t('authCancelled'))
    } catch {
      onMessage(t('failed'))
    } finally {
      setCancelBusy(false)
    }
  }

  async function add() {
    if (Boolean(url.trim()) === Boolean(command.trim())) { onMessage(t('selectTransport')); return }
    const environment: Record<string, string> = Object.create(null)
    if (command.trim()) {
      for (const rawLine of env.split('\n')) {
        const line = rawLine.trim()
        if (!line) continue
        const separator = line.indexOf('=')
        const key = line.slice(0, separator).trim()
        if (separator < 1 || !key) { onMessage(t('envFormat')); return }
        environment[key] = line.slice(separator + 1).trim()
      }
      if (catalogDraft && Object.values(environment).some(value => !value)) { onMessage(t('catalogSetupEnvRequired')); return }
    }
    const success = await run('mcp.add', {
      name: name.trim(), ...(url.trim()
        ? { url: url.trim(), auth, ...(auth === 'header' ? { bearer_token: token.trim() } : {}) }
        : { command: command.trim(), args: args.split('\n').map(v => v.trim()).filter(Boolean), env: environment }),
    }, 'mcp')
    if (catalogDraft) {
      const event = { operation: catalogDraft.operation }
      if (success) console.info('[mcp-setup] saved', event)
      else console.warn('[mcp-setup] save failed', event)
    }
    if (success) resetAddForm()
  }

  function resetAddForm() {
    setAdding(false)
    setName('')
    setUrl('')
    setCommand('')
    setArgs('')
    setEnv('')
    setToken('')
    setAuth('none')
    setCatalogDraft(null)
  }

  function startEdit(server: McpServer) {
    if (catalogDraft) resetAddForm()
    else setAdding(false)
    setEditing(server.name)
    setEditUrl(server.url || '')
    setEditCommand(server.command || '')
    setEditArgs((server.args || []).join('\n'))
  }

  async function saveEdit(server: McpServer) {
    const url = editUrl.trim()
    const command = editCommand.trim()
    if (server.url ? !url : !command) { onMessage(t('selectTransport')); return }
    const success = await run('mcp.update', {
      name: server.name,
      ...(server.url ? { url } : { command, args: editArgs.split('\n').map(value => value.trim()).filter(Boolean) }),
    }, 'mcp')
    if (success) setEditing(null)
  }

  async function test(name: string) {
    setTestBusy(name)
    setTestResults(current => { const next = { ...current }; delete next[name]; return next })
    try {
      const value = await request<{ ok: boolean; tools?: Array<{ name: string }>; error?: string }>('mcp.test', { name })
      setTestResults(current => ({ ...current, [name]: { ok: value.ok, tools: value.tools || [], error: value.error } }))
      onMessage(value.ok ? t('testOk', value.tools?.length || 0) : t('testFail', value.error || 'unknown'))
    } catch { onMessage(t('failed')) }
    finally { setTestBusy('') }
  }

  async function authorize(name: string) {
    try {
      const value = await request<McpOAuthFlow>('mcp.auth', { name })
      setAuthFlow(value)
      onMessage(value.status === 'approved' ? t('authDone') : value.status === 'error' ? value.error || t('failed') : t('authWaiting'))
    } catch { onMessage(t('failed')) }
  }

  return <>
    <div className="row extension-toolbar"><p>{t('installedHint')}</p><button disabled={busy} onClick={() => {
      setEditing(null)
      if (adding && catalogDraft) resetAddForm()
      else setAdding(!adding)
    }}>{adding ? t('cancel') : t('add')}</button></div>
    {adding && <section className="extension-detail">
      {catalogDraft && <p>{t('catalogSetupReview')} {catalogDraft.documentation && <a href={catalogDraft.documentation} target="_blank" rel="noopener noreferrer">{t('catalogSetupDocs')}</a>}</p>}
      <label>{t('name')}<input autoFocus={Boolean(catalogDraft)} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{t('url')}<input value={url} onChange={event => setUrl(event.target.value)} /></label>
      {url && <label>{t('auth')}<select value={auth} onChange={event => setAuth(event.target.value)}>
        <option value="none">{t('authNone')}</option><option value="oauth">{t('authOAuth')}</option><option value="header">{t('authHeader')}</option>
      </select></label>}
      {url && auth === 'header' && <label>{t('token')}<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>}
      <label>{t('command')}<input value={command} onChange={event => setCommand(event.target.value)} /></label>
      {command && <><label>{t('args')}<textarea value={args} onChange={event => setArgs(event.target.value)} /></label>
        <label>{t('env')}<textarea value={env} onChange={event => setEnv(event.target.value)} autoComplete="off" spellCheck={false} placeholder="API_KEY=…" /></label></>}
      <button disabled={busy || !name.trim() || (Boolean(url) && auth === 'header' && !token.trim())} onClick={() => void add()}>{t('save')}</button>
    </section>}
    {!servers.length && <p>{t('mcpEmpty')}</p>}
    <div className="extension-list">{servers.map(server => <article className="extension-card" key={server.name}>
      <div className="row"><strong>{server.name}</strong><small>{server.enabled ? t('enabled') : t('disabled')}</small></div>
      <small>{t('source')}: {server.plugin || server.source} · {t('transport')}: {server.transport}</small>
      <code>{server.url || [server.command, ...(server.args || [])].filter(Boolean).join(' ')}</code>
      {server.env && Object.keys(server.env).length > 0 && <small>{t('envNames', Object.keys(server.env).join('、'))}</small>}
      {testResults[server.name] && <p role="status">{testResults[server.name].ok
        ? testResults[server.name].tools.length ? t('connectedTools', testResults[server.name].tools.map(tool => tool.name).join('、')) : t('connectedNoTools')
        : t('testFail', testResults[server.name].error || 'unknown')}</p>}
      {editing === server.name && <section className="extension-detail">
        {server.url
          ? <label>{t('url')}<input value={editUrl} onChange={event => setEditUrl(event.target.value)} /></label>
          : <><label>{t('command')}<input value={editCommand} onChange={event => setEditCommand(event.target.value)} /></label>
            <label>{t('args')}<textarea value={editArgs} onChange={event => setEditArgs(event.target.value)} /></label></>}
        <p>{t('mcpEditHint')}</p>
        <div className="extension-actions">
          <button disabled={busy || (server.url ? !editUrl.trim() : !editCommand.trim())} onClick={() => void saveEdit(server)}>{t('save')}</button>
          <button disabled={busy} onClick={() => setEditing(null)}>{t('cancel')}</button>
        </div>
      </section>}
      <div className="extension-actions">
        <button disabled={busy || Boolean(testBusy)} onClick={() => void test(server.name)}>{testBusy === server.name ? t('working') : t('test')}</button>
        {server.enabled && needsAuth.has(server.name) && <span>{t('needsAuthorization')}</span>}
        {server.auth === 'oauth' && server.source !== 'plugin' && <button disabled={busy} onClick={() => void authorize(server.name)}>{t(needsAuth.has(server.name) ? 'reauthorize' : 'authorize')}</button>}
        {server.source !== 'plugin' && <>
          <button disabled={busy} onClick={() => editing === server.name ? setEditing(null) : startEdit(server)}>{editing === server.name ? t('cancel') : t('edit')}</button>
          <button disabled={busy} onClick={() => void run('mcp.toggle', { name: server.name, enabled: !server.enabled }, 'mcp')}>
            {server.enabled ? t('disable') : t('enable')}</button>
          <button disabled={busy} onClick={() => {
            if (window.confirm(t('removeConfirm'))) void run('mcp.remove', { name: server.name }, 'mcp')
          }}>{t('remove')}</button>
        </>}
      </div>
    </article>)}</div>
    {authFlow?.authorization_url && !isMcpOAuthTerminal(authFlow.status) && <section className="extension-detail">
      <p>{t('authWaiting')}</p>
      <div className="extension-actions">
        <a href={authFlow.authorization_url} target="_blank" rel="noopener noreferrer">{t('authOpen')}</a>
        <button onClick={() => void navigator.clipboard.writeText(authFlow.authorization_url || '')}>{t('authCopy')}</button>
        <button disabled={cancelBusy} onClick={() => void cancelAuthorization()}>{cancelBusy ? t('working') : t('authCancel')}</button>
      </div>
    </section>}
  </>
}
