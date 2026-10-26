import React from 'react'
import type { McpServer } from './model'
import type { labels } from './labels'

type T = ReturnType<typeof labels>
type Props = {
  servers: McpServer[]; busy: boolean; t: T;
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  run: (operation: string, payload?: Record<string, unknown>, after?: 'mcp') => Promise<boolean>
  onMessage: (message: string) => void
}

export default function LocalMcp({ servers, busy, t, request, run, onMessage }: Props) {
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [editUrl, setEditUrl] = React.useState('')
  const [editCommand, setEditCommand] = React.useState('')
  const [editArgs, setEditArgs] = React.useState('')
  const [name, setName] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [args, setArgs] = React.useState('')
  const [auth, setAuth] = React.useState('none')
  const [token, setToken] = React.useState('')
  const [testBusy, setTestBusy] = React.useState('')
  const [authFlow, setAuthFlow] = React.useState<{ flow_id: string; authorization_url?: string | null; status: string; error?: string | null } | null>(null)

  React.useEffect(() => {
    if (!authFlow || ['approved', 'error'].includes(authFlow.status)) return
    let active = true
    const timer = window.setInterval(() => {
      void request<typeof authFlow>('mcp.auth.status', { flow_id: authFlow.flow_id })
        .then(value => {
          if (!active) return
          setAuthFlow(value)
          if (value.status === 'approved') onMessage(t('authDone'))
          if (value.status === 'error') onMessage(value.error || t('failed'))
        }).catch(() => { if (active) onMessage(t('failed')) })
    }, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [authFlow?.flow_id, authFlow?.status])

  async function add() {
    if (Boolean(url.trim()) === Boolean(command.trim())) { onMessage(t('selectTransport')); return }
    const success = await run('mcp.add', {
      name: name.trim(), ...(url.trim()
        ? { url: url.trim(), auth, ...(auth === 'header' ? { bearer_token: token.trim() } : {}) }
        : { command: command.trim(), args: args.split('\n').map(v => v.trim()).filter(Boolean) }),
    }, 'mcp')
    if (success) { setAdding(false); setName(''); setUrl(''); setCommand(''); setArgs(''); setToken(''); setAuth('none') }
  }

  function startEdit(server: McpServer) {
    setAdding(false)
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
    try {
      const value = await request<{ ok: boolean; tools?: unknown[]; error?: string }>('mcp.test', { name })
      onMessage(value.ok ? t('testOk', value.tools?.length || 0) : t('testFail', value.error || 'unknown'))
    } catch { onMessage(t('failed')) }
    finally { setTestBusy('') }
  }

  async function authorize(name: string) {
    try {
      const value = await request<typeof authFlow>('mcp.auth', { name })
      setAuthFlow(value)
      onMessage(t('authWaiting'))
    } catch { onMessage(t('failed')) }
  }

  return <>
    <div className="row extension-toolbar"><p>{t('installedHint')}</p><button onClick={() => { setEditing(null); setAdding(!adding) }}>{adding ? t('cancel') : t('add')}</button></div>
    {adding && <section className="extension-detail">
      <label>{t('name')}<input value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{t('url')}<input value={url} onChange={event => setUrl(event.target.value)} /></label>
      {url && <label>{t('auth')}<select value={auth} onChange={event => setAuth(event.target.value)}>
        <option value="none">{t('authNone')}</option><option value="oauth">{t('authOAuth')}</option><option value="header">{t('authHeader')}</option>
      </select></label>}
      {url && auth === 'header' && <label>{t('token')}<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>}
      <label>{t('command')}<input value={command} onChange={event => setCommand(event.target.value)} /></label>
      {command && <label>{t('args')}<textarea value={args} onChange={event => setArgs(event.target.value)} /></label>}
      <button disabled={busy || !name.trim() || (Boolean(url) && auth === 'header' && !token.trim())} onClick={() => void add()}>{t('save')}</button>
    </section>}
    {!servers.length && <p>{t('empty')}</p>}
    <div className="extension-list">{servers.map(server => <article className="extension-card" key={server.name}>
      <div className="row"><strong>{server.name}</strong><small>{server.enabled ? t('enabled') : t('disabled')}</small></div>
      <small>{t('source')}: {server.plugin || server.source} · {t('transport')}: {server.transport}</small>
      <code>{server.url || [server.command, ...(server.args || [])].filter(Boolean).join(' ')}</code>
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
        {server.auth === 'oauth' && server.source !== 'plugin' && <button disabled={busy} onClick={() => void authorize(server.name)}>{t('authorize')}</button>}
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
    {authFlow?.authorization_url && authFlow.status !== 'approved' && <section className="extension-detail">
      <p>{t('authWaiting')}</p>
      <div className="extension-actions">
        <a href={authFlow.authorization_url} target="_blank" rel="noopener noreferrer">{t('authOpen')}</a>
        <button onClick={() => void navigator.clipboard.writeText(authFlow.authorization_url || '')}>{t('authCopy')}</button>
      </div>
    </section>}
  </>
}
