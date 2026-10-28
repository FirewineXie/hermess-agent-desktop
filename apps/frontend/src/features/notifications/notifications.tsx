import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { shouldNotify, type NotificationTarget } from './notificationPolicy'

type NotificationPreferences = {
  enabled: boolean
  approval: boolean
  input: boolean
  turnDone: boolean
  turnError: boolean
  sound: boolean
}

const key = 'hermess.desktop.notifications.v1'
const defaults: NotificationPreferences = { enabled: true, approval: true, input: true, turnDone: true, turnError: true, sound: true }
function readPreferences(): NotificationPreferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') } } catch { return defaults }
}
function writePreferences(value: NotificationPreferences) {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('hermess-notification-preferences', { detail: value }))
}
function completionSound() {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = 660
  gain.gain.setValueAtTime(0.08, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.18)
  oscillator.onended = () => void context.close()
}

export function useNativeNotificationBridge(connectionId: string | null, activeTarget?: NotificationTarget) {
  const { events, notifications } = useDesktop()
  const language = useLanguage()
  const seen = React.useRef(new Set<string>())
  const activeTargetRef = React.useRef(activeTarget)
  activeTargetRef.current = activeTarget
  React.useEffect(() => {
    if (!connectionId) return
    seen.current.clear()
    let active = true
    let stopEvent: (() => void) | undefined
    let stopRequest: (() => void) | undefined
    const backgrounded = () => document.hidden || !document.hasFocus()
    const notify = (category: keyof NotificationPreferences, title: string, body: string, target?: NotificationTarget & { approvalRequestId?: string }) => {
      const prefs = readPreferences()
      if (!prefs.enabled || !prefs[category]) return
      void notifications.show(title, body, target ? { ...target, connectionId, locale: language } : undefined).catch(() => {})
      if (prefs.sound && (category === 'turnDone' || category === 'turnError')) try { completionSound() } catch { /* audio output unavailable */ }
    }
    void events.onGatewayEvent(event => {
      if (event.connection_id !== connectionId) return
      const identity = `${connectionId}:${event.profile || ''}:${event.session_id || ''}:${event.seq ?? ''}:${event.kind}`
      if (seen.current.has(identity)) return
      seen.current.add(identity)
      if (seen.current.size > 1000) seen.current = new Set([...seen.current].slice(-500))
      if (event.kind === 'message.complete') {
        const failed = event.payload?.status === 'error'
        const target = event.profile && event.session_id ? { profile: event.profile, sessionId: event.session_id } : undefined
        const category = failed ? 'turnError' : 'turnDone'
        if (shouldNotify(category, backgrounded(), target, activeTargetRef.current)) notify(category, failed ? 'Hermess 任务失败' : 'Hermess 已完成', String(event.payload?.text || (failed ? '请返回会话查看错误。' : '回复已生成。')).slice(0, 300), target)
      } else if (event.kind === 'error') {
        const target = event.profile && event.session_id ? { profile: event.profile, sessionId: event.session_id } : undefined
        if (shouldNotify('turnError', backgrounded(), target, activeTargetRef.current)) notify('turnError', 'Hermess 运行错误', '请返回会话查看详情。', target)
      }
    }).then(stop => { if (active) stopEvent = stop; else stop() }).catch(() => {})
    void events.onGatewayRequest(request => {
      if (request.connection_id !== connectionId) return
      const identity = `${connectionId}:${request.profile || ''}:${request.params.session_id}:${request.id}:${request.method}`
      if (seen.current.has(identity)) return
      seen.current.add(identity)
      if (seen.current.size > 1000) seen.current = new Set([...seen.current].slice(-500))
      const target = request.profile && request.params.session_id ? { profile: request.profile, sessionId: String(request.params.session_id) } : undefined
      if (request.method === 'approval' && shouldNotify('approval', backgrounded(), target, activeTargetRef.current)) notify('approval', 'Hermess 需要审批', String(request.params.description || request.params.command || '有一项工具操作等待决定。').slice(0, 300), target ? { ...target, approvalRequestId: request.id } : undefined)
      else if (request.method === 'clarify' && shouldNotify('input', backgrounded(), target, activeTargetRef.current)) notify('input', 'Hermess 需要补充信息', '有一个问题等待回答。', target)
    }).then(stop => { if (active) stopRequest = stop; else stop() }).catch(() => {})
    return () => { active = false; stopEvent?.(); stopRequest?.() }
  }, [connectionId, events, notifications, language])
}

export default function NotificationsSettings({ page }: { page: 'alerts' | 'sounds' }) {
  const { notifications } = useDesktop()
  const language = useLanguage()
  const [preferences, setPreferences] = React.useState(readPreferences)
  const [status, setStatus] = React.useState('')
  const [systemPermission, setSystemPermission] = React.useState<boolean | null>(null)
  const [permissionBusy, setPermissionBusy] = React.useState(false)
  React.useEffect(() => {
    let active = true
    void notifications.permission().then(granted => { if (active) setSystemPermission(granted) }).catch(error => { if (active) setStatus(describeError(error, language)) })
    return () => { active = false }
  }, [notifications, language])
  const update = (patch: Partial<NotificationPreferences>) => { const next = { ...preferences, ...patch }; setPreferences(next); writePreferences(next) }
  const askPermission = async () => {
    setPermissionBusy(true)
    try {
      const granted = await notifications.requestPermission()
      setSystemPermission(granted)
      setStatus(granted ? (language === 'zh-CN' ? '系统通知权限已授予。' : 'System notification permission granted.') : (language === 'zh-CN' ? '系统通知权限未授予。' : 'System notification permission was not granted.'))
    } catch (error) { setStatus(describeError(error, language)) }
    finally { setPermissionBusy(false) }
  }
  const test = async () => {
    try { await notifications.show(language === 'zh-CN' ? 'Hermess 测试通知' : 'Hermess test notification', language === 'zh-CN' ? '桌面通知原生投递已响应。' : 'Native notification delivery responded.'); setSystemPermission(true); setStatus(language === 'zh-CN' ? '测试通知已提交给系统' : 'Test notification submitted to the system') }
    catch (error) { setStatus(describeError(error, language)) }
  }
  const rows: Array<[keyof NotificationPreferences, string, string]> = [
    ['approval', language === 'zh-CN' ? '审批请求' : 'Approval requests', language === 'zh-CN' ? '工具操作需要允许或拒绝。' : 'A tool action needs approval.'],
    ['input', language === 'zh-CN' ? '补充信息' : 'Input requests', language === 'zh-CN' ? 'Hermess 有问题需要回答。' : 'Hermess needs an answer.'],
    ['turnDone', language === 'zh-CN' ? '任务完成' : 'Turn completed', language === 'zh-CN' ? '窗口在后台时提醒回复已完成。' : 'Notify when a background turn completes.'],
    ['turnError', language === 'zh-CN' ? '任务失败' : 'Turn failed', language === 'zh-CN' ? '运行失败或 Gateway 返回错误。' : 'A run failed or the Gateway returned an error.'],
  ]
  return <div className="notification-settings">
    <div className="row"><div><h2>{page === 'alerts' ? (language === 'zh-CN' ? '桌面提醒' : 'Desktop alerts') : (language === 'zh-CN' ? '完成提示音' : 'Completion sound')}</h2><p>{language === 'zh-CN' ? '偏好保存在本机，不写入任何 Profile 的 config.yaml。' : 'Preferences stay on this device and are not written to Profile config.yaml.'}</p></div><button onClick={() => void test()}>{language === 'zh-CN' ? '发送测试通知' : 'Send test notification'}</button></div>
    {page === 'alerts' ? <><div className="notification-row"><span><strong>{language === 'zh-CN' ? '系统通知权限' : 'System permission'}</strong><small>{systemPermission === null ? (language === 'zh-CN' ? '正在检查…' : 'Checking…') : systemPermission ? (language === 'zh-CN' ? '已授予' : 'Granted') : (language === 'zh-CN' ? '未授权或需要确认' : 'Not granted or needs confirmation')}</small></span>{systemPermission === false && <button type="button" disabled={permissionBusy} onClick={() => void askPermission()}>{language === 'zh-CN' ? '请求授权' : 'Request permission'}</button>}</div><label className="notification-master"><span><strong>{language === 'zh-CN' ? '启用系统通知' : 'Enable system notifications'}</strong><small>{language === 'zh-CN' ? '通过桌面宿主投递原生通知。' : 'Deliver native notifications through the desktop host.'}</small></span><input type="checkbox" checked={preferences.enabled} onChange={event => update({ enabled: event.target.checked })} /></label>{rows.map(([id, title, detail]) => <label key={id} className="notification-row"><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" checked={preferences[id]} disabled={!preferences.enabled} onChange={event => update({ [id]: event.target.checked })} /></label>)}<div className="notification-row unavailable"><span><strong>{language === 'zh-CN' ? '后台任务、额度与插件' : 'Background jobs, credits, and plugins'}</strong><small>{language === 'zh-CN' ? '当前锁定 Gateway 尚未向客户端提供可核对的对应事件，因此不放出无效开关。' : 'The locked Gateway does not expose verifiable matching events, so non-functional toggles are not shown.'}</small></span><em>{language === 'zh-CN' ? '不可用' : 'Unavailable'}</em></div></> : <label className="notification-row"><span><strong>{language === 'zh-CN' ? '任务完成与失败提示音' : 'Completion and failure sound'}</strong><small>{language === 'zh-CN' ? '与系统通知偏好分开保存。' : 'Stored separately from system notification preferences.'}</small></span><input type="checkbox" checked={preferences.sound} onChange={event => update({ sound: event.target.checked })} /></label>}
    <p role="status">{status}</p>
  </div>
}
