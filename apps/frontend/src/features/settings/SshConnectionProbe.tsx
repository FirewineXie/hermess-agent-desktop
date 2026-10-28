import React from 'react'
import type { BackendInfo, SshConnectionProbe as ProbeResult, SshTarget } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

const statusText: Record<ProbeResult['status'], { zh: string; en: string }> = {
  reachable: { zh: 'SSH 认证通过，远端平台可用；尚未建立网关连接。', en: 'SSH authentication passed and the remote platform is supported. No gateway connection has been established.' },
  unsupported_platform: { zh: 'SSH 已连接，但远端不是受支持的 Linux 或 macOS。', en: 'SSH connected, but the remote platform is neither Linux nor macOS.' },
  ssh_missing: { zh: '本机未找到系统 OpenSSH 客户端。', en: 'The system OpenSSH client was not found.' },
  host_key_changed: { zh: '远端主机密钥已变化，SSH 拒绝连接。', en: 'The remote host key changed; SSH refused the connection.' },
  auth_failed: { zh: 'SSH 密钥或代理认证失败。', en: 'SSH key or agent authentication failed.' },
  unreachable: { zh: '无法连接 SSH 主机。', en: 'The SSH host is unreachable.' },
  ssh_failed: { zh: 'SSH 探测失败，请检查主机配置。', en: 'SSH probing failed; check the host configuration.' },
  timeout: { zh: 'SSH 探测超时。', en: 'SSH probing timed out.' },
  preview_only: { zh: 'PREVIEW_ONLY：浏览器预览无法执行系统 SSH。', en: 'PREVIEW_ONLY: The browser preview cannot run system SSH.' },
}

type Props = {
  onBeforeSwitch: () => boolean
  onSwitch: (next: BackendInfo) => void
}

export default function SshConnectionProbe({ onBeforeSwitch, onSwitch }: Props) {
  const { connections } = useDesktop()
  const language = useLanguage()
  const [host, setHost] = React.useState('')
  const [user, setUser] = React.useState('')
  const [port, setPort] = React.useState('22')
  const [keyPath, setKeyPath] = React.useState('')
  const [remotePort, setRemotePort] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [token, setToken] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<ProbeResult | null>(null)
  const [error, setError] = React.useState('')
  const [saved, setSaved] = React.useState<'saved' | 'connected' | null>(null)

  const target = (): SshTarget => ({ host: host.trim(), user: user.trim(), port: Number(port), remotePort: Number(remotePort), keyPath: keyPath.trim() })

  async function testConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setResult(null)
    setError('')
    try {
      setResult(await connections.testSsh(host.trim(), user.trim(), Number(port), keyPath.trim()))
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setBusy(false)
    }
  }

  async function saveConnection(connect: boolean) {
    if (busy || !host.trim() || !label.trim() || !token || !remotePort) return
    if (connect && !onBeforeSwitch()) return
    setBusy(true)
    setSaved(null)
    setError('')
    try {
      const entry = await connections.saveRemoteSsh(label.trim(), target(), token)
      setSaved('saved')
      if (connect) {
        const applied = await connections.applySaved(entry.id)
        onSwitch({ kind: 'remote', connection_id: applied.connectionId, replay_epoch: applied.replayEpoch, label: applied.label })
        setSaved('connected')
      }
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setToken('')
      setBusy(false)
    }
  }

  return <section className="remote-connection-probe">
    <h2>{language === 'zh-CN' ? 'SSH 网关连接' : 'SSH gateway connection'}</h2>
    <p>{language === 'zh-CN' ? '使用系统 OpenSSH 和现有密钥认证。保存时只连接远端回环地址上已运行的 Hermes 网关；桌面程序只管理 SSH 隧道，不启动或停止远端进程。' : 'Use system OpenSSH and your existing key authentication. Saving connects to an existing Hermes gateway on the remote loopback address. Desktop manages only the SSH tunnel.'}</p>
    <form onSubmit={event => void testConnection(event)}>
      <label><span>{language === 'zh-CN' ? 'SSH 主机或配置别名' : 'SSH host or config alias'}</span><input value={host} onChange={event => setHost(event.target.value)} disabled={busy} required autoComplete="off" /></label>
      <label><span>{language === 'zh-CN' ? '用户名（可选）' : 'User (optional)'}</span><input value={user} onChange={event => setUser(event.target.value)} disabled={busy} autoComplete="off" /></label>
      <label><span>{language === 'zh-CN' ? '端口' : 'Port'}</span><input type="number" min="1" max="65535" value={port} onChange={event => setPort(event.target.value)} disabled={busy} required /></label>
      <label><span>{language === 'zh-CN' ? '密钥文件（可选）' : 'Identity file (optional)'}</span><input value={keyPath} onChange={event => setKeyPath(event.target.value)} disabled={busy} autoComplete="off" /></label>
      <label><span>{language === 'zh-CN' ? '远端网关端口（保存时必填）' : 'Remote gateway port (required to save)'}</span><input type="number" min="1" max="65535" value={remotePort} onChange={event => setRemotePort(event.target.value)} disabled={busy} /></label>
      <label><span>{language === 'zh-CN' ? '连接名称' : 'Connection name'}</span><input value={label} onChange={event => setLabel(event.target.value)} disabled={busy} maxLength={100} /></label>
      <label><span>{language === 'zh-CN' ? '网关会话令牌' : 'Gateway session token'}</span><input type="password" value={token} onChange={event => setToken(event.target.value)} disabled={busy} autoComplete="off" /></label>
      <div className="remote-connection-actions"><button type="submit" disabled={busy || !host.trim() || !port}>{busy ? (language === 'zh-CN' ? '正在检查…' : 'Checking…') : (language === 'zh-CN' ? '测试 SSH' : 'Test SSH')}</button><button type="button" disabled={busy || !host.trim() || !remotePort || !label.trim() || !token} onClick={() => void saveConnection(false)}>{language === 'zh-CN' ? '验证网关并保存' : 'Verify gateway and save'}</button><button type="button" disabled={busy || !host.trim() || !remotePort || !label.trim() || !token} onClick={() => void saveConnection(true)}>{language === 'zh-CN' ? '验证、保存并连接' : 'Verify, save and connect'}</button></div>
    </form>
    {result && <p role="status" className={result.status === 'reachable' ? 'ready' : 'failed'}>{statusText[result.status][language === 'zh-CN' ? 'zh' : 'en']}{result.platform ? ` · ${result.platform}` : ''}</p>}
    {error && <p role="alert" className="failed">{error}</p>}
    {saved && <p role="status" className="ready">{saved === 'connected' ? (language === 'zh-CN' ? 'SSH 网关已保存并连接。' : 'SSH gateway saved and connected.') : (language === 'zh-CN' ? 'SSH 网关已保存，可在“已保存连接”中应用。' : 'SSH gateway saved; apply it from Saved connections.')}</p>}
  </section>
}
