import React from 'react'
import type { RemoteGatewayConfig, RemoteGatewayProbe } from '@hermess/contracts'
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
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    let active = true
    void runtime.savedRemote().then(config => {
      if (!active) return
      setSaved(config)
      setLabel(config?.label || '')
      setUrl(config?.url || '')
    }).catch(error => { if (active) setMessage(describeError(error, language)) })
    return () => { active = false }
  }, [runtime, language])

  async function run(action: 'test' | 'save') {
    if (busy) return
    setBusy(true)
    setMessage('')
    setProbe(null)
    try {
      if (action === 'test') {
        const result = await runtime.testRemote(url.trim(), token)
        setProbe(result)
        setMessage(zh ? '连接和令牌验证成功。' : 'Connection and token verified.')
      } else {
        const config = await runtime.saveRemote(label.trim(), url.trim(), token)
        setSaved(config)
        setToken('')
        setMessage(zh ? '远程 Gateway 已保存。' : 'Remote gateway saved.')
      }
    } catch (error) {
      setMessage(describeError(error, language))
    } finally { setBusy(false) }
  }

  return <section className="runtime-remote-settings" aria-labelledby="runtime-remote-title">
    <h3 id="runtime-remote-title">{zh ? '远程 Gateway' : 'Remote gateway'}</h3>
    <p>{zh ? '先建立 SSH 隧道，将云电脑的 Gateway 映射到这台电脑的 127.0.0.1 端口。' : 'Create an SSH tunnel to forward the cloud gateway to a 127.0.0.1 port on this computer.'}</p>
    <label>{zh ? '名称' : 'Name'}<input value={label} maxLength={64} onChange={event => setLabel(event.target.value)} /></label>
    <label>{zh ? '本机转发地址' : 'Local forwarded address'}<input value={url} placeholder="http://127.0.0.1:9119" onChange={event => setUrl(event.target.value)} /></label>
    <label>{zh ? 'Gateway 会话令牌' : 'Gateway session token'}<input type="password" value={token} autoComplete="off" onChange={event => setToken(event.target.value)} /></label>
    <div className="runtime-remote-actions">
      <button type="button" disabled={busy || !url.trim() || !token} onClick={() => void run('test')}>{zh ? '测试连接' : 'Test connection'}</button>
      <button type="button" disabled={busy || !label.trim() || !url.trim() || !token} onClick={() => void run('save')}>{zh ? '验证并保存' : 'Verify and save'}</button>
    </div>
    {saved && <small>{zh ? '已保存：' : 'Saved: '}{saved.label} · {saved.url}</small>}
    {probe && <small>{zh ? '可用 Bot：' : 'Available Bots: '}{probe.profiles.join(' · ')}</small>}
    {message && <p role="status">{message}</p>}
  </section>
}
