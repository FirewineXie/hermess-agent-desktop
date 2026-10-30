import React from 'react'
import type { DeviceStatus } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'

export default function DeviceSettings({ page, language }: { page: 'device' | 'quick-input'; language: Language }) {
  const { device } = useDesktop()
  const zh = language === 'zh-CN'
  const [status, setStatus] = React.useState<DeviceStatus | null>(null)
  const [shortcut, setShortcut] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const generation = React.useRef(0)
  const saving = React.useRef(false)
  const shortcutEdited = React.useRef(false)
  React.useEffect(() => {
    let active = true
    const read = () => {
      if (saving.current) return
      const request = generation.current
      void device.status().then(value => { if (active && request === generation.current) { setStatus(value); if (!shortcutEdited.current) setShortcut(value.preferences.shortcut) } }).catch(cause => { if (active && request === generation.current) setError(describeError(cause, language)) })
    }
    read(); const timer = window.setInterval(read, 2500)
    return () => { active = false; ++generation.current; clearInterval(timer) }
  }, [device, language])
  const save = async (patch: Partial<DeviceStatus['preferences']>) => {
    if (!status || saving.current) return
    const request = ++generation.current
    saving.current = true
    setBusy(true); setError('')
    try { const next = await device.save({ ...status.preferences, ...patch }); if (request === generation.current) { setStatus(next); setShortcut(next.preferences.shortcut); shortcutEdited.current = false } }
    catch (cause) { if (request === generation.current) { setError(describeError(cause, language)); setShortcut(status.preferences.shortcut); shortcutEdited.current = false } }
    finally { saving.current = false; if (request === generation.current) setBusy(false) }
  }
  if (!status) return <p role="status">{error || (zh ? '正在读取设备设置…' : 'Loading device settings…')}</p>
  return <section className="settings-form-page desktop-settings">
    <h2>{page === 'device' ? (zh ? '设备偏好' : 'Device preferences') : (zh ? '全局快捷输入' : 'Global quick input')}</h2>
    <p>{zh ? '仅保存在本产品的设备配置中。' : 'Saved in this product’s device configuration only.'}</p>
    {page === 'device' ? <>
      <label className="notification-setting-row"><span><strong>{zh ? '运行时保持唤醒' : 'Keep awake while the runtime runs'}</strong><small>{zh ? '仅阻止系统自动休眠；运行时停止或退出时释放。' : 'Prevent idle sleep; release when the runtime stops or the app exits.'}</small></span><input type="checkbox" disabled={busy} checked={status.preferences.keepAwake} onChange={e => void save({ keepAwake: e.target.checked })} /></label>
      <p>{zh ? `当前唤醒请求：${status.awake ? '已生效' : '未生效'}` : `Wake assertion: ${status.awake ? 'active' : 'inactive'}`}</p>
      <label className="notification-setting-row"><span><strong>{zh ? '允许 F12 开发者工具' : 'Allow F12 developer tools'}</strong><small>{status.f12Supported ? (zh ? '使用 Windows WebView2 开发者工具。' : 'Uses Windows WebView2 developer tools.') : (zh ? '当前平台不支持此开关。' : 'This switch is unavailable on this platform.')}</small></span><input type="checkbox" disabled={busy || !status.f12Supported} checked={status.preferences.f12Devtools} onChange={e => void save({ f12Devtools: e.target.checked })} /></label>
    </> : <>
      <label className="notification-setting-row"><span><strong>{zh ? '启用全局快捷输入' : 'Enable global quick input'}</strong><small>{zh ? '呼出独立输入窗，发送到主窗口当前 Profile 和会话。' : 'Open a composer for the main window’s current Profile and session.'}</small></span><input type="checkbox" disabled={busy} checked={status.preferences.quickEnabled} onChange={e => void save({ quickEnabled: e.target.checked })} /></label>
      <form className="desktop-shortcut-form" onSubmit={e => { e.preventDefault(); void save({ shortcut }) }}><label>{zh ? '全局快捷键' : 'Global shortcut'}<input value={shortcut} disabled={busy} onChange={e => { shortcutEdited.current = true; setShortcut(e.target.value) }} /></label><button disabled={busy || !shortcut.trim() || shortcut === status.preferences.shortcut}>{zh ? '应用快捷键' : 'Apply shortcut'}</button></form>
      <p>{zh ? `注册状态：${status.registered ? '已注册' : '未注册'}` : `Shortcut: ${status.registered ? 'registered' : 'not registered'}`}</p>
      <p>{zh ? 'CommandOrControl 在 macOS 使用 Command，在 Windows 使用 Ctrl。快捷键被占用或保存失败时保留原设置。Esc 或失焦隐藏输入窗并保留草稿。' : 'CommandOrControl uses Command on macOS and Ctrl on Windows. Failed changes preserve the previous shortcut. Escape or focus loss hides the composer and keeps its draft.'}</p>
    </>}
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
  </section>
}
