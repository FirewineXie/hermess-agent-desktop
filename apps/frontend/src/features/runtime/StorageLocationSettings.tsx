import React from 'react'
import type { StorageLocationAction, StorageLocationSettings as Settings } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { displayPath } from '../../shared/displayPath'

export function StorageLocationPanel({ settings, draft, busy, message, gatewayRunning = false, onChoose, onSave, onCancel, onRetry }: {
  settings: Settings | null; draft: string; busy: boolean; message: string; gatewayRunning?: boolean
  onChoose: () => void; onSave: () => void; onCancel: () => void; onRetry: () => void
}) {
  const zh = useLanguage() === 'zh-CN'
  const reasons: Record<string, string> = zh ? {
    gateway_running: '请先在上方运行时控制中停止本地 Gateway，再更改存储位置。',
    invalid_path: '请选择普通目录，不能使用符号链接、目录联接或产品数据内部的目录。',
    unavailable: '目录不存在、不可写或磁盘不可用。请恢复目录或重新选择。',
    invalid_data: '所选目录中的 HermessAgentDesktop 子目录结构不兼容，请选择其他目录。',
    in_use: '此目录正被其他本产品实例使用，请先退出该实例再重试。',
    same_path: '已在使用此位置。', save_failed: '存储设置保存失败，请重试。', development: '开发环境使用独立的开发数据目录。',
  } : {
    gateway_running: 'Stop the local gateway using the runtime controls above before changing the storage location.',
    invalid_path: 'Choose a regular directory outside product data, without symbolic links or junctions.',
    unavailable: 'The directory is missing, not writable, or its disk is unavailable. Restore it or choose another directory.',
    invalid_data: 'The HermessAgentDesktop subdirectory is incompatible. Choose another directory.',
    in_use: 'Another product instance is using this directory. Exit that instance and retry.',
    same_path: 'This location is already in use.', save_failed: 'Could not save storage settings. Retry.', development: 'Development uses an isolated development data directory.',
  }
  return <section aria-labelledby="storage-location-title">
    <h3 id="storage-location-title">{zh ? '存储位置' : 'Storage location'}</h3>
    <label>{zh ? '当前使用位置' : 'Current location'}<input readOnly value={displayPath(settings?.currentPath || '')} /></label>
    {settings?.pendingPath && <label>{zh ? '待生效位置' : 'Pending location'}<input readOnly value={displayPath(settings.pendingPath)} /></label>}
    {settings?.blocked && <p role="alert">{zh ? '待生效位置启用失败，数据功能尚未启动。恢复目录后重试，或取消更改使用原位置。' : 'The pending location could not be activated. Data features are blocked. Restore the directory and retry, or cancel the change to use the previous location.'}</p>}
    {gatewayRunning && <p role="status">{reasons.gateway_running}</p>}
    {settings && !settings.enabled && <p>{reasons.development}</p>}
    {draft && <div role="group" aria-label={zh ? '确认更改存储位置' : 'Confirm storage change'}>
      <label>{zh ? '新位置' : 'New location'}<input readOnly value={displayPath(draft)} /></label>
      <p>{zh ? '下次启动将使用此位置。应用不会移动或删除原位置的数据。新目录需要重新配置；已有本产品数据的目录会使用其中的数据，不合并。原数据保留，可再次更改位置切换回来。' : 'This location will be used on the next launch. Existing data will not be moved or deleted. A new directory needs configuration; existing product data will be used without merging. You can switch back later.'}</p>
      <button type="button" disabled={busy || gatewayRunning} onClick={onSave}>{zh ? '保存，下次启动生效' : 'Save for next launch'}</button>
    </div>}
    <button type="button" disabled={busy || gatewayRunning || !settings?.enabled} onClick={onChoose}>{zh ? '更改位置' : 'Change location'}</button>
    {settings?.pendingPath && <button type="button" disabled={busy} onClick={onCancel}>{zh ? '取消更改' : 'Cancel change'}</button>}
    {settings?.blocked && <button type="button" disabled={busy} onClick={onRetry}>{zh ? '重试启用' : 'Retry activation'}</button>}
    {settings?.pendingPath && !settings.blocked && <p>{zh ? '已保存。请从托盘退出应用，再重新打开。关闭窗口到托盘或重启后端不会使更改生效。' : 'Saved. Exit the application from the tray and reopen it. Hiding the window or restarting the backend will not apply this change.'}</p>}
    {settings?.error && <p role="alert">{reasons[settings.error] || (zh ? '操作失败，请重试。' : 'Operation failed. Retry.')}</p>}
    {message && <p role="status">{message}</p>}
    {!settings && <button type="button" disabled={busy} onClick={onRetry}>{zh ? '重新读取' : 'Reload settings'}</button>}
  </section>
}

export default function StorageLocationSettings({ gatewayRunning = false }: { gatewayRunning?: boolean }) {
  const { runtime, nativeFiles } = useDesktop()
  const language = useLanguage()
  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(true)
  const [message, setMessage] = React.useState('')
  const running = React.useRef(false)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    let active = true
    void runtime.storageLocation({ action: 'get' }).then(value => { if (active) setSettings(value) })
      .catch(error => { if (active) setMessage(describeError(error, language)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; mounted.current = false }
  }, [runtime, language])

  async function run(request: StorageLocationAction) {
    if (running.current || (request.action === 'save' && gatewayRunning)) return
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      const next = await runtime.storageLocation(request)
      if (!mounted.current) return
      setSettings(next)
      if (!next.error) setDraft('')
      // Native startup was blocked, so no old data-dependent runtime is active.
      if ((!settings || settings.blocked) && !next.blocked) window.location.reload()
    } catch (error) { if (mounted.current) setMessage(describeError(error, language)) }
    finally { running.current = false; if (mounted.current) setBusy(false) }
  }

  async function choose() {
    if (running.current || gatewayRunning) return
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      const selected = await nativeFiles.choose({ directory: true, multiple: false, title: language === 'zh-CN' ? '更改存储位置' : 'Change storage location' })
      if (mounted.current && typeof selected === 'string') setDraft(selected)
    } catch (error) { if (mounted.current) setMessage(describeError(error, language)) }
    finally { running.current = false; if (mounted.current) setBusy(false) }
  }

  return <StorageLocationPanel settings={settings} draft={draft} busy={busy} message={message} gatewayRunning={gatewayRunning}
    onChoose={() => void choose()} onSave={() => void run({ action: 'save', path: draft })}
    onCancel={() => void run({ action: 'cancel' })} onRetry={() => void run({ action: settings?.blocked ? 'retry' : 'get' })} />
}
