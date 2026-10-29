import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { readNotificationPreferences, writeNotificationPreferences, type NotificationPreferences } from './preferences'

type Props = { page: 'alerts' | 'sounds'; language: Language }

export default function NotificationsSettings({ page, language }: Props) {
  const { notifications } = useDesktop()
  const zh = language === 'zh-CN'
  const [preferences, setPreferences] = React.useState(readNotificationPreferences)
  const [permission, setPermission] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  React.useEffect(() => {
    let active = true
    void notifications.permission().then(value => { if (active) setPermission(value) }).catch(cause => { if (active) setStatus(describeError(cause, language)) })
    return () => { active = false }
  }, [notifications, language])
  const update = (patch: Partial<NotificationPreferences>) => {
    const next = { ...preferences, ...patch }
    setPreferences(next)
    writeNotificationPreferences(next)
  }
  const request = async () => {
    setBusy(true)
    try {
      const granted = await notifications.requestPermission()
      setPermission(granted)
      setStatus(granted ? (zh ? '系统通知权限已授予。' : 'System notification permission granted.') : (zh ? '系统通知权限未授予。' : 'System notification permission was not granted.'))
    } catch (cause) { setStatus(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true)
    try {
      await notifications.show(zh ? 'Hermess 测试通知' : 'Hermess test notification', zh ? '桌面客户端已将测试通知提交给系统。' : 'The desktop client submitted this notification to the system.')
      setPermission(true)
      setStatus(zh ? '测试通知已发送；若横幅未显示，请查看系统通知中心。' : 'Test notification sent. Check the system notification center if no banner appeared.')
    } catch (cause) { setStatus(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const rows: Array<[keyof NotificationPreferences, string, string]> = [
    ['approval', zh ? '审批请求' : 'Approval requests', zh ? '工具操作需要允许或拒绝。' : 'A tool action needs approval.'],
    ['input', zh ? '补充信息' : 'Input requests', zh ? 'Hermess 有问题需要回答。' : 'Hermess needs an answer.'],
    ['turnDone', zh ? '任务完成' : 'Turn completed', zh ? '当前会话在后台完成时提醒。' : 'Notify when the active turn completes in the background.'],
    ['turnError', zh ? '任务失败' : 'Turn failed', zh ? '当前会话在后台失败时提醒。' : 'Notify when the active turn fails in the background.'],
    ['backgroundDone', zh ? '后台任务与其他会话' : 'Background tasks and other conversations', zh ? '窗口在后台时，子任务完成或其他会话结束会提醒。' : 'Notify about side tasks and other conversations while the window is backgrounded.'],
    ['credits', zh ? '额度提醒' : 'Credits notices', zh ? '窗口在后台时，提醒运行时报告的额度不足、用量预警或恢复。' : 'Notify about runtime credit warnings, limits, and recovery while backgrounded.'],
    ['plugin', zh ? '插件消息' : 'Plugin messages', zh ? '窗口在后台时，提醒已安装插件发给会话的消息。' : 'Notify about installed plugins’ messages while the window is backgrounded.'],
  ]
  return <div className="notification-settings settings-form-page">
    <div className="settings-form-heading"><div><h2>{page === 'alerts' ? (zh ? '桌面提醒' : 'Desktop alerts') : (zh ? '完成提示音' : 'Completion sound')}</h2><p>{zh ? '偏好只保存在这台设备，不写入 Profile。' : 'Preferences stay on this device and are not written to a Profile.'}</p></div><button type="button" disabled={busy} onClick={() => void test()}>{zh ? '发送测试通知' : 'Send test notification'}</button></div>
    {page === 'alerts' ? <>
      <div className="notification-setting-row"><span><strong>{zh ? '系统通知权限' : 'System permission'}</strong><small>{permission === null ? (zh ? '正在检查…' : 'Checking…') : permission ? (zh ? '已授予' : 'Granted') : (zh ? '未授权' : 'Not granted')}</small></span>{permission === false && <button type="button" disabled={busy} onClick={() => void request()}>{zh ? '请求授权' : 'Request permission'}</button>}</div>
      <label className="notification-setting-row"><span><strong>{zh ? '启用系统通知' : 'Enable system notifications'}</strong><small>{zh ? '通过 Windows 或 macOS 原生通知中心投递。' : 'Deliver through the Windows or macOS notification center.'}</small></span><input type="checkbox" checked={preferences.enabled} onChange={event => update({ enabled: event.target.checked })} /></label>
      {rows.map(([key, title, detail]) => <label className="notification-setting-row" key={key}><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" disabled={!preferences.enabled} checked={preferences[key]} onChange={event => update({ [key]: event.target.checked })} /></label>)}
    </> : <label className="notification-setting-row"><span><strong>{zh ? '任务完成与失败提示音' : 'Completion and failure sound'}</strong><small>{zh ? '只在触发完成或失败系统通知时播放。' : 'Play only when a completion or failure notification is triggered.'}</small></span><input type="checkbox" checked={preferences.sound} onChange={event => update({ sound: event.target.checked })} /></label>}
    {status && <p role="status">{status}</p>}
  </div>
}
