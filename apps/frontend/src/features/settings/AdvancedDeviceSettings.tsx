import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import './settings-extra.css'

type DevicePreferences = { keepAwake: boolean; f12Devtools: boolean }
type QuickEntryRegistration = { enabled: boolean; shortcut: string; registered: boolean; error: 'taken' | 'invalid' | 'preview' | null }
type WakeLockHandle = { release(): Promise<void>; addEventListener?(type: 'release', listener: () => void): void }
export const DEVICE_PREFERENCES_KEY = 'hermess.desktop.device-preferences.v1'
export function readDevicePreferences(): DevicePreferences {
  try { return { keepAwake: false, f12Devtools: false, ...JSON.parse(localStorage.getItem(DEVICE_PREFERENCES_KEY) || '{}') } } catch { return { keepAwake: false, f12Devtools: false } }
}

export default function AdvancedDeviceSettings() {
  const { windowChrome, quickEntry } = useDesktop()
  const language = useLanguage()
  const [preferences, setPreferences] = React.useState(readDevicePreferences)
  const [status, setStatus] = React.useState('')
  const [quickRegistration, setQuickRegistration] = React.useState<QuickEntryRegistration | null>(null)
  const [shortcutInput, setShortcutInput] = React.useState('')
  const [quickBusy, setQuickBusy] = React.useState(false)
  const wakeLock = React.useRef<WakeLockHandle | null>(null)
  const save = React.useCallback((next: DevicePreferences) => { setPreferences(next); localStorage.setItem(DEVICE_PREFERENCES_KEY, JSON.stringify(next)) }, [])
  const acquireWakeLock = React.useCallback(async () => {
    if (wakeLock.current) return
    const manager = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockHandle> } }).wakeLock
    if (!manager) throw new Error(language === 'zh-CN' ? '当前平台不支持保持唤醒' : 'Wake Lock is unavailable on this platform')
    const handle = await manager.request('screen')
    handle.addEventListener?.('release', () => { if (wakeLock.current === handle) wakeLock.current = null })
    wakeLock.current = handle
  }, [language])
  const changeWakeLock = async (enabled: boolean) => {
    try {
      if (enabled) await acquireWakeLock()
      else { await wakeLock.current?.release(); wakeLock.current = null }
      save({ ...preferences, keepAwake: enabled })
      setStatus(enabled ? (language === 'zh-CN' ? '已在当前应用会话保持唤醒' : 'Wake Lock is active for this app session') : (language === 'zh-CN' ? '已释放保持唤醒' : 'Wake Lock released'))
    } catch (error) { setStatus(describeError(error, language)); save({ ...preferences, keepAwake: false }) }
  }
  const changeDevtools = async (enabled: boolean) => {
    try { await windowChrome.setFrontendDebugEnabled(enabled); save({ ...preferences, f12Devtools: enabled }); setStatus(enabled ? (language === 'zh-CN' ? '已允许 F12 开发者工具' : 'F12 developer tools enabled') : (language === 'zh-CN' ? '已禁用 F12 开发者工具' : 'F12 developer tools disabled')) }
    catch (error) { setStatus(describeError(error, language)) }
  }
  React.useEffect(() => {
    let active = true
    void quickEntry.registration().then(result => {
      if (active) { setQuickRegistration(result); setShortcutInput(result.shortcut) }
    }).catch(error => { if (active) setStatus(describeError(error, language)) })
    return () => { active = false }
  }, [quickEntry, language])
  const saveQuickEntry = async (enabled: boolean, shortcut: string) => {
    if (quickBusy) return
    setQuickBusy(true)
    try {
      const result = await quickEntry.save(enabled, shortcut.trim())
      setQuickRegistration(result)
      if (!result.error) { setShortcutInput(result.shortcut); setStatus(enabled ? (language === 'zh-CN' ? '快捷输入已启用' : 'Quick entry enabled') : (language === 'zh-CN' ? '快捷输入已关闭' : 'Quick entry disabled')) }
      else setStatus(result.error === 'preview' ? (language === 'zh-CN' ? 'PREVIEW_ONLY：仅展示交互，系统快捷键需在桌面客户端验证。' : 'PREVIEW_ONLY: test the system shortcut in the desktop app.')
        : result.error === 'taken' ? (language === 'zh-CN' ? '快捷键已被其他应用占用，原设置保持不变。' : 'Shortcut is taken; the previous setting remains active.')
          : (language === 'zh-CN' ? '快捷键无效；请使用修饰键加一个按键。' : 'Invalid shortcut; use a modifier plus one key.'))
    } catch (error) { setStatus(describeError(error, language)) }
    finally { setQuickBusy(false) }
  }
  React.useEffect(() => {
    if (!preferences.keepAwake) return
    const reacquire = () => {
      if (document.visibilityState !== 'visible') return
      void acquireWakeLock().catch(error => {
        setStatus(describeError(error, language))
        save({ ...readDevicePreferences(), keepAwake: false })
      })
    }
    reacquire()
    document.addEventListener('visibilitychange', reacquire)
    return () => document.removeEventListener('visibilitychange', reacquire)
  }, [preferences.keepAwake, acquireWakeLock, language, save])
  React.useEffect(() => () => { void wakeLock.current?.release() }, [])
  return <section className="advanced-device-settings">
    <h2>{language === 'zh-CN' ? '设备本地偏好' : 'Device-local preferences'}</h2><p>{language === 'zh-CN' ? '这些选项只影响本机，不写入 Hermes Profile。' : 'These options affect only this device and are not written to a Hermes Profile.'}</p>
    <label><span><strong>{language === 'zh-CN' ? '运行时保持唤醒' : 'Keep awake while running'}</strong><small>{language === 'zh-CN' ? '使用系统支持的 Wake Lock；关闭应用或系统回收时自动释放。' : 'Uses the platform Wake Lock and releases it when the app closes or the system revokes it.'}</small></span><input type="checkbox" checked={preferences.keepAwake} onChange={event => void changeWakeLock(event.target.checked)} /></label>
    <label><span><strong>{language === 'zh-CN' ? '允许 F12 开发者工具' : 'Allow F12 developer tools'}</strong><small>{language === 'zh-CN' ? 'Windows WebView2 支持；其他平台会明确报告不可用。' : 'Supported by Windows WebView2; other platforms report unavailable.'}</small></span><input type="checkbox" checked={preferences.f12Devtools} onChange={event => void changeDevtools(event.target.checked)} /></label>
    <div className="device-setting-quick-entry">
      <label><span><strong>{language === 'zh-CN' ? '系统级快捷输入' : 'System-wide quick entry'}</strong><small>{language === 'zh-CN' ? '从任何窗口呼出独立输入窗，消息发送到当前 Profile 的聊天会话。' : 'Open a separate composer from any window and send to the current Profile chat.'}</small></span><input type="checkbox" checked={quickRegistration?.enabled || false} disabled={!quickRegistration || quickBusy} onChange={event => void saveQuickEntry(event.target.checked, quickRegistration?.shortcut || shortcutInput)} /></label>
      <div className="quick-entry-shortcut"><label htmlFor="quick-entry-shortcut">{language === 'zh-CN' ? '呼出快捷键' : 'Shortcut'}</label><input id="quick-entry-shortcut" value={shortcutInput} disabled={!quickRegistration || quickBusy} onChange={event => setShortcutInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveQuickEntry(quickRegistration?.enabled || false, shortcutInput) } }} /><button type="button" disabled={!quickRegistration || quickBusy || shortcutInput === quickRegistration.shortcut} onClick={() => void saveQuickEntry(quickRegistration?.enabled || false, shortcutInput)}>{language === 'zh-CN' ? '应用' : 'Apply'}</button><small>{quickRegistration?.error === 'preview' ? 'PREVIEW_ONLY' : quickRegistration?.registered ? (language === 'zh-CN' ? '已向系统注册' : 'Registered') : (language === 'zh-CN' ? '未注册' : 'Not registered')}</small></div>
    </div>
    <p role="status">{status}</p>
  </section>
}
