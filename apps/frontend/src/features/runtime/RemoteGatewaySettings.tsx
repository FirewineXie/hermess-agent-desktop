import React from 'react'
import { isDesktopFailure, type RemoteGatewayConfig, type RemoteGatewayProbe } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type Props = {
  onConnect: (id: string) => Promise<void>
  setupRequested: boolean
  onSetupOpened: () => void
}

export default function RemoteGatewaySettings({ onConnect, setupRequested, onSetupOpened }: Props) {
  const { runtime } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [saved, setSaved] = React.useState<RemoteGatewayConfig[]>([])
  const [label, setLabel] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [token, setToken] = React.useState('')
  const [sshTarget, setSshTarget] = React.useState('')
  const [probe, setProbe] = React.useState<RemoteGatewayProbe | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<unknown>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<RemoteGatewayConfig | null>(null)
  const [message, setMessage] = React.useState('')
  const [editorError, setEditorError] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const dialog = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    void runtime.savedRemote().then(configs => {
      if (!active) return
      setSaved(configs)
    }).catch(error => { if (active) setLoadError(error) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [runtime])

  const openEditor = React.useCallback((config?: RemoteGatewayConfig) => {
    const node = dialog.current
    if (!node || node.open) return
    setEditing(Boolean(config))
    setLabel(config?.label ?? '')
    setUrl(config?.url ?? '')
    setToken('')
    setSshTarget(config?.sshTarget ?? '')
    setProbe(null)
    setEditorError('')
    node.showModal()
  }, [])

  React.useEffect(() => {
    if (setupRequested) {
      openEditor()
      onSetupOpened()
    }
  }, [setupRequested, openEditor, onSetupOpened])

  function closeEditor() {
    dialog.current?.close()
    setToken('')
  }

  async function run(action: 'test' | 'save' | 'delete') {
    if (busy || loading || (action === 'delete' && !confirmDelete)) return
    setBusy(true)
    setLoadError(null)
    setMessage('')
    setProbe(null)
    setEditorError('')
    try {
      if (action === 'test') {
        const result = await runtime.testRemote(url.trim(), token)
        setProbe(result)
      } else if (action === 'save') {
        await runtime.saveRemote(label.trim(), url.trim(), token, sshTarget.trim() || undefined)
        setSaved(await runtime.savedRemote())
        closeEditor()
        setMessage(zh ? '远程 Gateway 已保存。' : 'Remote gateway saved.')
      } else if (confirmDelete) {
        await runtime.deleteRemote(confirmDelete.id)
        setSaved(items => items.filter(item => item.id !== confirmDelete.id))
        setConfirmDelete(null)
        setMessage(zh ? '已删除本机保存的远程 Gateway 配置和令牌。' : 'Saved remote gateway configuration and token deleted from this computer.')
      }
    } catch (error) {
      if (action !== 'delete') {
        setEditorError(describeError(error, language))
      } else setMessage(isDesktopFailure(error) && error.code === 'conflict'
        ? (zh ? '配置已变化或远程 Gateway 仍在使用。请切回本地 Gateway，并重新打开此页后重试。' : 'The configuration changed or a remote gateway is still active. Switch to the local gateway and reopen this page before retrying.')
        : describeError(error, language))
    } finally { setBusy(false) }
  }

  const controlsDisabled = busy || loading || Boolean(confirmDelete)
  const saveDisabled = controlsDisabled || !label.trim() || !url.trim() || !token
  return <section className="runtime-remote-settings" aria-labelledby="runtime-remote-title">
    <div className="runtime-remote-header">
      <h3 id="runtime-remote-title">{zh ? '远程 Gateway' : 'Remote gateway'}</h3>
      <button type="button" disabled={controlsDisabled} onClick={() => openEditor()}>{zh ? '添加远程 Gateway' : 'Add remote gateway'}</button>
    </div>
    {!loading && loadError == null && saved.length === 0 && <p>{zh ? '尚未添加远程 Gateway。' : 'No remote gateways added yet.'}</p>}
    {saved.map(config => <div className="runtime-remote-saved" key={config.id}>
      <small>{config.label} · {config.url}</small>
      <button type="button" disabled={controlsDisabled} onClick={() => {
        setBusy(true)
        void onConnect(config.id).finally(() => setBusy(false))
      }}>{zh ? '连接' : 'Connect'}</button>
      <button type="button" disabled={controlsDisabled} onClick={() => openEditor(config)}>{zh ? '更新配置' : 'Update configuration'}</button>
      <button type="button" disabled={controlsDisabled} onClick={() => { setMessage(''); setConfirmDelete(config) }}>{zh ? '删除配置' : 'Delete configuration'}</button>
    </div>)}
    {confirmDelete && <div role="group" aria-label={zh ? '确认删除远程 Gateway 配置' : 'Confirm remote gateway deletion'}>
      <p>{zh ? `删除这台电脑保存的「${confirmDelete.label}」地址和令牌？远程服务和会话数据会保留。` : `Delete the address and token saved for "${confirmDelete.label}"? The remote service and sessions will remain.`}</p>
      <div className="runtime-remote-actions">
        <button type="button" disabled={busy} onClick={() => void run('delete')}>{busy ? (zh ? '删除中…' : 'Deleting…') : (zh ? '确认删除' : 'Confirm deletion')}</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}>{zh ? '取消' : 'Cancel'}</button>
      </div>
    </div>}
    {loadError != null && <p role="alert">{describeError(loadError, language)}</p>}
    {message && <p role="status">{message}</p>}
    <dialog ref={dialog} className="runtime-remote-dialog" aria-labelledby="runtime-remote-dialog-title" onCancel={event => {
      event.preventDefault()
      if (!busy) closeEditor()
    }}>
      <form onSubmit={event => { event.preventDefault(); if (!saveDisabled) void run('save') }}>
        <h3 id="runtime-remote-dialog-title">{editing ? (zh ? '更新远程 Gateway' : 'Update remote gateway') : (zh ? '添加远程 Gateway' : 'Add remote gateway')}</h3>
        <p>{zh ? '用 SSH 隧道把自托管 Gateway 转发到本机 127.0.0.1 端口。填写 SSH 终端目标后，可从主机终端面板打开该机器的 Shell。' : 'Forward a self-hosted gateway to a local 127.0.0.1 port over SSH. Set an SSH terminal target to open a shell on that host from the terminal panel.'}</p>
        <label>{zh ? '名称' : 'Name'}<input value={label} required disabled={busy} maxLength={64} onChange={event => setLabel(event.target.value)} /></label>
        <label>{zh ? '本机转发地址' : 'Local forwarded address'}<input value={url} required disabled={busy} placeholder="http://127.0.0.1:9119" onChange={event => setUrl(event.target.value)} /></label>
        <label>{zh ? 'Gateway 会话令牌' : 'Gateway session token'}<input type="password" value={token} required disabled={busy} autoComplete="off" onChange={event => setToken(event.target.value)} /></label>
        <label>{zh ? 'SSH 终端目标（可选）' : 'SSH terminal target (optional)'}<input value={sshTarget} disabled={busy} maxLength={253} placeholder={zh ? 'SSH 别名或 user@host' : 'SSH alias or user@host'} onChange={event => setSshTarget(event.target.value)} /></label>
        {probe && <p role="status">{zh ? '连接和令牌验证成功。可用 Bot：' : 'Connection and token verified. Available Bots: '}{probe.profiles.join(' · ')}</p>}
        {editorError && <p role="alert">{editorError}</p>}
        <div className="runtime-remote-actions">
          <button type="button" className="dialog-secondary-action" disabled={busy} onClick={closeEditor}>{zh ? '取消' : 'Cancel'}</button>
          <button type="button" className="dialog-secondary-action" disabled={controlsDisabled || !url.trim() || !token} onClick={() => void run('test')}>{zh ? '测试连接' : 'Test connection'}</button>
          <button type="submit" className="dialog-primary-action" disabled={saveDisabled}>{zh ? '验证并保存' : 'Verify and save'}</button>
        </div>
      </form>
    </dialog>
  </section>
}
