import React from 'react'
import { isDesktopFailure, type RemoteGatewayConfig, type RemoteGatewayProbe } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

export default function RemoteGatewaySettings() {
  const { runtime } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [saved, setSaved] = React.useState<RemoteGatewayConfig | null>(null)
  const [label, setLabel] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [token, setToken] = React.useState('')
  const [probe, setProbe] = React.useState<RemoteGatewayProbe | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<unknown>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    void runtime.savedRemote().then(config => {
      if (!active) return
      setSaved(config)
      setLabel(config?.label || '')
      setUrl(config?.url || '')
    }).catch(error => { if (active) setLoadError(error) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [runtime])

  async function run(action: 'test' | 'save' | 'delete') {
    if (busy || loading || (action === 'delete' && (!saved || !confirmDelete))) return
    setBusy(true)
    setLoadError(null)
    setMessage('')
    setProbe(null)
    try {
      if (action === 'test') {
        const result = await runtime.testRemote(url.trim(), token)
        setProbe(result)
        setMessage(zh ? '连接和令牌验证成功。' : 'Connection and token verified.')
      } else if (action === 'save') {
        const config = await runtime.saveRemote(label.trim(), url.trim(), token)
        setSaved(config)
        setToken('')
        setMessage(zh ? '远程 Gateway 已保存。' : 'Remote gateway saved.')
      } else if (saved) {
        await runtime.deleteRemote(saved.id)
        setSaved(null)
        setLabel('')
        setUrl('')
        setToken('')
        setConfirmDelete(false)
        setMessage(zh ? '已删除本机保存的远程 Gateway 配置和令牌。' : 'Saved remote gateway configuration and token deleted from this computer.')
      }
    } catch (error) {
      setMessage(action === 'delete' && isDesktopFailure(error) && error.code === 'conflict'
        ? (zh ? '配置已变化或远程 Gateway 仍在使用。请切回本地 Gateway，并重新打开此页后重试。' : 'The configuration changed or a remote gateway is still active. Switch to the local gateway and reopen this page before retrying.')
        : describeError(error, language))
    } finally { setBusy(false) }
  }

  return <section className="runtime-remote-settings" aria-labelledby="runtime-remote-title">
    <h3 id="runtime-remote-title">{zh ? '远程 Gateway' : 'Remote gateway'}</h3>
    <p>{zh ? '先建立 SSH 隧道，将云电脑的 Gateway 映射到这台电脑的 127.0.0.1 端口。' : 'Create an SSH tunnel to forward the cloud gateway to a 127.0.0.1 port on this computer.'}</p>
    <label>{zh ? '名称' : 'Name'}<input value={label} disabled={busy || loading} maxLength={64} onChange={event => setLabel(event.target.value)} /></label>
    <label>{zh ? '本机转发地址' : 'Local forwarded address'}<input value={url} disabled={busy || loading} placeholder="http://127.0.0.1:9119" onChange={event => setUrl(event.target.value)} /></label>
    <label>{zh ? 'Gateway 会话令牌' : 'Gateway session token'}<input type="password" value={token} disabled={busy || loading} autoComplete="off" onChange={event => setToken(event.target.value)} /></label>
    <div className="runtime-remote-actions">
      <button type="button" disabled={busy || loading || confirmDelete || !url.trim() || !token} onClick={() => void run('test')}>{zh ? '测试连接' : 'Test connection'}</button>
      <button type="button" disabled={busy || loading || confirmDelete || !label.trim() || !url.trim() || !token} onClick={() => void run('save')}>{zh ? '验证并保存' : 'Verify and save'}</button>
    </div>
    {saved && <div className="runtime-remote-saved">
      <small>{zh ? '已保存：' : 'Saved: '}{saved.label} · {saved.url}</small>
      {!confirmDelete && <button type="button" disabled={busy || loading} onClick={() => { setMessage(''); setConfirmDelete(true) }}>{zh ? '删除配置' : 'Delete configuration'}</button>}
    </div>}
    {saved && confirmDelete && <div role="group" aria-label={zh ? '确认删除远程 Gateway 配置' : 'Confirm remote gateway deletion'}>
      <p>{zh ? '删除此电脑保存的地址和令牌？远程服务和会话数据不会删除；再次连接时需要重新配置。' : 'Delete the address and token saved on this computer? The remote service and sessions will remain. Connecting again will require configuration.'}</p>
      <div className="runtime-remote-actions">
        <button type="button" disabled={busy} onClick={() => void run('delete')}>{busy ? (zh ? '删除中…' : 'Deleting…') : (zh ? '确认删除' : 'Confirm deletion')}</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>{zh ? '取消' : 'Cancel'}</button>
      </div>
    </div>}
    {probe && <small>{zh ? '可用 Bot：' : 'Available Bots: '}{probe.profiles.join(' · ')}</small>}
    {loadError != null && <p role="alert">{describeError(loadError, language)}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}
