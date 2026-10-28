import React from 'react'
import type { BackendInfo, RemoteConnectionProbe as ProbeResult } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

const messages: Record<ProbeResult['status'], { zh: string; en: string }> = {
  ready: { zh: 'HTTP 鉴权和 WebSocket 聊天通道均通过', en: 'HTTP authentication and the chat WebSocket both passed' },
  status_unreachable: { zh: '无法读取网关状态，请检查地址和网络', en: 'Could not read gateway status; check the URL and network' },
  oauth_required: { zh: '此网关要求 OAuth 登录，当前令牌测试不适用', en: 'This gateway requires OAuth sign-in; token testing does not apply' },
  http_unreachable: { zh: '网关状态可达，但受保护的 Profile 接口不可用', en: 'Gateway status is reachable, but the protected profile endpoint is unavailable' },
  auth_rejected: { zh: '网关拒绝了令牌', en: 'The gateway rejected the token' },
  invalid_response: { zh: '受保护接口返回了不符合预期的数据', en: 'The protected endpoint returned unexpected data' },
  ws_failed: { zh: 'HTTP 鉴权通过，但 WebSocket 聊天通道失败', en: 'HTTP authentication passed, but the chat WebSocket failed' },
}

type Props = {
  onBeforeSwitch: () => boolean
  onSwitch: (next: BackendInfo) => void
}

export default function RemoteConnectionProbe({ onBeforeSwitch, onSwitch }: Props) {
  const { connections } = useDesktop()
  const language = useLanguage()
  const [label, setLabel] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [token, setToken] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<ProbeResult | null>(null)
  const [error, setError] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  const [connected, setConnected] = React.useState(false)

  async function testConnection(action: 'test' | 'save' | 'connect') {
    if (!url.trim() || !token || busy || (action !== 'test' && !label.trim())) return
    if (action === 'connect' && !onBeforeSwitch()) return
    const suppliedToken = token
    setBusy(true)
    setResult(null)
    setError('')
    setSaved(false)
    setConnected(false)
    try {
      const probe = await connections.testRemoteUrl(url.trim(), suppliedToken)
      setResult(probe)
      if (action !== 'test' && probe.status === 'ready') {
        const entry = await connections.saveRemoteUrl(label.trim(), probe.baseUrl, suppliedToken)
        setSaved(true)
        if (action === 'connect') {
          const applied = await connections.applySaved(entry.id)
          onSwitch({ kind: 'remote', connection_id: applied.connectionId, replay_epoch: applied.replayEpoch, label: applied.label })
          setConnected(true)
        }
      }
    } catch (cause) {
      setResult(null)
      setError(describeError(cause, language))
    } finally {
      setToken('')
      setBusy(false)
    }
  }

  return <section className="remote-connection-probe">
    <h2>{language === 'zh-CN' ? 'URL 网关连接' : 'Gateway URL connection'}</h2>
    <p>{language === 'zh-CN'
      ? '输入外部 Hermes 网关地址和会话令牌。测试依次检查网关状态、受保护的 Profile 接口与聊天 WebSocket；保存时令牌进入系统凭据库，页面不会回填令牌。'
      : 'Enter an external Hermes gateway URL and session token. The test checks status, the protected profile endpoint, and the chat WebSocket. Saving stores the token in the system credential store; the page never refills it.'}</p>
    <form onSubmit={event => { event.preventDefault(); void testConnection('test') }}>
      <label><span>{language === 'zh-CN' ? '连接名称（保存时必填）' : 'Connection name (required to save)'}</span><input type="text" value={label} disabled={busy} onChange={event => { setLabel(event.target.value); setSaved(false) }} placeholder={language === 'zh-CN' ? '例如：工作网关' : 'For example: Work gateway'} maxLength={100} /></label>
      <label><span>{language === 'zh-CN' ? '网关地址' : 'Gateway URL'}</span><input type="text" inputMode="url" value={url} disabled={busy} onChange={event => { setUrl(event.target.value); setResult(null); setSaved(false) }} placeholder="https://gateway.example" autoComplete="url" required /></label>
      <label><span>{language === 'zh-CN' ? '会话令牌' : 'Session token'}</span><input type="password" value={token} disabled={busy} onChange={event => { setToken(event.target.value); setResult(null); setSaved(false) }} autoComplete="off" required /></label>
      <div className="remote-connection-actions"><button type="submit" disabled={busy || !url.trim() || !token}>{busy ? (language === 'zh-CN' ? '正在检查…' : 'Checking…') : (language === 'zh-CN' ? '测试连接' : 'Test connection')}</button><button type="button" disabled={busy || !label.trim() || !url.trim() || !token} onClick={() => void testConnection('save')}>{language === 'zh-CN' ? '测试并保存' : 'Test and save'}</button><button type="button" disabled={busy || !label.trim() || !url.trim() || !token} onClick={() => void testConnection('connect')}>{language === 'zh-CN' ? '测试、保存并连接' : 'Test, save and connect'}</button></div>
    </form>
    {result && <p role="status" className={result.status === 'ready' ? 'ready' : 'failed'}>{messages[result.status][language === 'zh-CN' ? 'zh' : 'en']}{result.status === 'ready' ? ` · ${result.baseUrl} · ${result.profileCount ?? 0} Profiles${result.version ? ` · ${result.version}` : ''}` : ''}</p>}
    {error && <p role="alert" className="failed">{error}</p>}
    {saved && <p role="status" className="ready">{connected
      ? (language === 'zh-CN' ? `已保存并连接「${label.trim()}」。` : `Saved and connected to “${label.trim()}”.`)
      : (language === 'zh-CN' ? `已保存「${label.trim()}」；可在“已保存连接”中查看。` : `Saved “${label.trim()}”; see Saved connections.`)}</p>}
    <small>{language === 'zh-CN' ? '“测试并保存”只建立连接记录；“测试、保存并连接”会切换当前聊天。令牌在操作后从表单清空。' : '“Test and save” only creates a connection record; “Test, save and connect” switches the active chat. The token is cleared after the action.'}</small>
  </section>
}
