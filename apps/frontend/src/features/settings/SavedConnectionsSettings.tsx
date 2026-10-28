import React from 'react'
import type { BackendInfo, SavedRemoteConnection } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type Props = {
  backend: BackendInfo | null
  onBeforeSwitch: () => boolean
  onSwitch: (next: BackendInfo | null) => void
}

export default function SavedConnectionsSettings({ backend, onBeforeSwitch, onSwitch }: Props) {
  const { connections } = useDesktop()
  const language = useLanguage()
  const [items, setItems] = React.useState<SavedRemoteConnection[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState('')

  React.useEffect(() => {
    let active = true
    void connections.listSaved().then(saved => {
      if (active) setItems(saved)
    }).catch(error => {
      if (active) setStatus(describeError(error, language))
    }).finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [connections, language])

  async function remove(item: SavedRemoteConnection) {
    setBusyId(item.id)
    setStatus('')
    try {
      await connections.deleteSaved(item.id)
      setItems(current => current.filter(entry => entry.id !== item.id))
      setPendingDelete(null)
      setStatus(language === 'zh-CN' ? `已删除「${item.label}」及其系统凭据。` : `Deleted “${item.label}” and its system credential.`)
    } catch (error) {
      setStatus(describeError(error, language))
    } finally { setBusyId(null) }
  }

  async function apply(item: SavedRemoteConnection) {
    if (!onBeforeSwitch()) return
    setBusyId(item.id)
    setStatus('')
    try {
      const result = await connections.applySaved(item.id)
      onSwitch({ kind: 'remote', connection_id: result.connectionId, replay_epoch: result.replayEpoch, label: result.label })
      setStatus(language === 'zh-CN' ? `已连接「${item.label}」。远程专属功能仍以页面可用状态为准。` : `Connected to “${item.label}”. Remote features remain subject to each page's availability.`)
    } catch (error) {
      setStatus(describeError(error, language))
    } finally { setBusyId(null) }
  }

  async function returnToLocal() {
    if (!onBeforeSwitch()) return
    setBusyId('local')
    setStatus('')
    try {
      const info = await connections.returnToLocal()
      onSwitch(info)
      setStatus(language === 'zh-CN' ? '已切回本地连接。' : 'Returned to the local connection.')
    } catch (error) {
      setStatus(describeError(error, language))
    } finally { setBusyId(null) }
  }

  return <section className="saved-connections-settings">
    <h2>{language === 'zh-CN' ? '已保存连接' : 'Saved connections'}</h2>
    <p>{language === 'zh-CN' ? '连接摘要保存在本产品配置目录，令牌保存在操作系统凭据库。删除会同时清除连接摘要与对应凭据。' : 'Connection summaries live in the product config directory; tokens live in the operating system credential store. Deleting removes both.'}</p>
    <p>{language === 'zh-CN' ? 'URL 和 SSH 连接可用于远程会话及已适配的配置接口。SSH 模式需要远端网关已经运行。远端支持创建自定义 Profile；本机工作目录和按路径附加文件仍不可用。' : 'URL and SSH connections support remote sessions and adapted configuration APIs. SSH requires an already running remote gateway. Custom profiles can be created remotely; local workspace paths and path based attachments remain unavailable.'}</p>
    {backend?.connection_id !== 'local' && backend && <button type="button" disabled={busyId !== null} onClick={() => void returnToLocal()}>{language === 'zh-CN' ? '切回本地连接' : 'Return to local'}</button>}
    {!loaded && <p role="status">{language === 'zh-CN' ? '正在读取…' : 'Loading…'}</p>}
    {loaded && items.length === 0 && <p>{language === 'zh-CN' ? '暂无已保存的远程连接。' : 'No remote connections have been saved.'}</p>}
    <div className="saved-connection-list">{items.map(item => <article key={item.id}>
      <div><strong>{item.label}</strong><small>{item.baseUrl}</small><small>{backend?.connection_id === item.id ? (language === 'zh-CN' ? '当前连接' : 'Active connection') : `${item.kind.toUpperCase()} · ${language === 'zh-CN' ? '令牌鉴权' : 'token authentication'}`}</small></div>
      <button type="button" disabled={busyId !== null} onClick={() => void apply(item)}>{backend?.connection_id === item.id ? (language === 'zh-CN' ? '重新连接' : 'Reconnect') : (language === 'zh-CN' ? `连接 ${item.kind.toUpperCase()} 网关` : `Connect ${item.kind.toUpperCase()} gateway`)}</button>
      {pendingDelete === item.id ? <div className="saved-connection-actions"><button type="button" disabled={busyId !== null} onClick={() => void remove(item)}>{language === 'zh-CN' ? '确认删除' : 'Confirm delete'}</button><button type="button" disabled={busyId !== null} onClick={() => setPendingDelete(null)}>{language === 'zh-CN' ? '取消' : 'Cancel'}</button></div>
        : <button type="button" disabled={busyId !== null || backend?.connection_id === item.id} onClick={() => setPendingDelete(item.id)}>{language === 'zh-CN' ? '删除' : 'Delete'}</button>}
    </article>)}</div>
    <p role="status">{status}</p>
  </section>
}
