import React from 'react'
import type { ApprovalChoice, NotificationAction, NotificationTarget } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import type { Language } from '../../i18n'
import { eventNotificationKey, NotificationDeduper, requestNotificationKey, shouldNotify, type NotificationKind, type NotificationSession } from './notificationPolicy'
import { readNotificationPreferences } from './preferences'
import { ExtendedNotificationTracker } from './extendedNotifications'

type Props = {
  connectionId: string | null
  activeTarget?: NotificationSession
  language: Language
  onOpenSession(profile: string, sessionId: string): Promise<void>
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

export function useNativeNotifications({ connectionId, activeTarget, language, onOpenSession }: Props) {
  const { chat, events, notifications } = useDesktop()
  const activeTargetRef = React.useRef(activeTarget)
  const openSessionRef = React.useRef(onOpenSession)
  const deduper = React.useMemo(() => new NotificationDeduper(), [connectionId])
  const extended = React.useMemo(() => new ExtendedNotificationTracker(), [connectionId])
  activeTargetRef.current = activeTarget
  openSessionRef.current = onOpenSession

  React.useEffect(() => {
    let active = true
    let stopAction: (() => void) | undefined
    const handle = async (action: NotificationAction) => {
      if (!active || action.target.connectionId !== connectionId) return
      if (action.kind === 'approval' && action.target.approvalRequestId && action.choice) {
        await chat.answerRequest({ kind: 'session', profile: action.target.profile, sessionId: action.target.sessionId }, {
          requestId: action.target.approvalRequestId,
          method: 'approval',
          choice: action.choice as ApprovalChoice,
        })
        return
      }
      await openSessionRef.current(action.target.profile, action.target.sessionId)
    }
    void notifications.onAction(action => { void handle(action).catch(() => {}) }).then(stop => {
      if (active) stopAction = stop
      else stop()
    }).catch(() => {})
    return () => { active = false; stopAction?.() }
  }, [chat, notifications, connectionId])

  React.useEffect(() => {
    if (!connectionId) return
    const zh = language === 'zh-CN'
    let active = true
    let stopEvent: (() => void) | undefined
    let stopRequest: (() => void) | undefined
    const backgrounded = () => document.hidden || !document.hasFocus()
    const show = (kind: NotificationKind, title: string, body: string, target?: NotificationSession & { approvalRequestId?: string }) => {
      const preferences = readNotificationPreferences()
      if (!preferences.enabled || !preferences[kind]) return
      const nativeTarget: NotificationTarget | undefined = target ? { ...target, connectionId, locale: language } : undefined
      void notifications.show(title, body, nativeTarget).catch(() => {})
      if (preferences.sound && (kind === 'turnDone' || kind === 'turnError' || kind === 'backgroundDone')) {
        try { completionSound() } catch { /* The selected output device may not support Web Audio. */ }
      }
    }
    void events.onGatewayEvent(event => {
      if (!active) return
      const notice = extended.consume(connectionId, event)
      if (notice && shouldNotify(notice.kind, backgrounded(), notice.target, activeTargetRef.current)) {
        const titles = {
          backgroundDone: zh ? 'Hermess 后台任务完成' : 'Hermess background task completed',
          credits: zh ? 'Hermess 额度提醒' : 'Hermess credits notice',
          plugin: zh ? 'Hermess 插件消息' : 'Hermess plugin message',
        }
        show(notice.kind, titles[notice.kind], notice.text, notice.target)
      }
      if (!active || !deduper.add(eventNotificationKey(connectionId, event))) return
      const target = event.profile && event.session_id ? { profile: event.profile, sessionId: event.session_id } : undefined
      if (event.kind === 'message.complete') {
        if (event.payload.status === 'interrupted') return
        const failed = event.payload.status === 'error'
        const sameSession = target && activeTargetRef.current?.profile === target.profile && activeTargetRef.current?.sessionId === target.sessionId
        const kind = sameSession ? (failed ? 'turnError' : 'turnDone') : 'backgroundDone'
        if (shouldNotify(kind, backgrounded(), target, activeTargetRef.current)) {
          const fallback = failed ? (zh ? '请返回会话查看错误。' : 'Return to the conversation to inspect the error.') : (zh ? '回复已生成。' : 'The response is ready.')
          const text = typeof event.payload.text === 'string' ? event.payload.text : fallback
          show(kind, failed ? (zh ? 'Hermess 任务失败' : 'Hermess task failed') : kind === 'backgroundDone' ? (zh ? 'Hermess 后台会话完成' : 'Hermess background conversation completed') : (zh ? 'Hermess 已完成' : 'Hermess completed'), text.slice(0, 300), target)
        }
      } else if (event.kind === 'error' && shouldNotify('turnError', backgrounded(), target, activeTargetRef.current)) {
        show('turnError', zh ? 'Hermess 运行错误' : 'Hermess runtime error', zh ? '请返回会话查看详情。' : 'Return to the conversation for details.', target)
      }
    }).then(stop => { if (active) stopEvent = stop; else stop() }).catch(() => {})
    void events.onGatewayRequest(request => {
      if (!active || !deduper.add(requestNotificationKey(connectionId, request))) return
      const target = request.profile ? { profile: request.profile, sessionId: request.params.session_id } : undefined
      if (request.method === 'approval' && shouldNotify('approval', backgrounded(), target, activeTargetRef.current)) {
        const detail = request.params.description || request.params.command || (zh ? '有一项工具操作等待决定。' : 'A tool action is waiting for your decision.')
        show('approval', zh ? 'Hermess 需要审批' : 'Hermess needs approval', detail.slice(0, 300), target ? { ...target, approvalRequestId: request.id } : undefined)
      } else if (request.method === 'clarify' && shouldNotify('input', backgrounded(), target, activeTargetRef.current)) {
        show('input', zh ? 'Hermess 需要补充信息' : 'Hermess needs more information', zh ? '有一个问题等待回答。' : 'A question is waiting for your answer.', target)
      }
    }).then(stop => { if (active) stopRequest = stop; else stop() }).catch(() => {})
    return () => { active = false; stopEvent?.(); stopRequest?.() }
  }, [connectionId, events, notifications, language, deduper, extended])
}
