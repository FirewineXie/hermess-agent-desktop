// Development-only harness: exercises the production hook without OS delivery.
import React from 'react'
import type { DesktopApi, GatewayEvent, NotificationTarget } from '@hermess/contracts'
import { DesktopProvider } from '../app/DesktopContext'
import NotificationsSettings from '../features/notifications/NotificationsSettings'
import { useNativeNotifications } from '../features/notifications/useNativeNotifications'

function Bridge({ onOpen }: { onOpen: (profile: string, session: string) => Promise<void> }) {
  useNativeNotifications({ connectionId: 'PREVIEW_ONLY', activeTarget: { profile: 'default', sessionId: 'active' }, language: 'zh-CN', onOpenSession: onOpen })
  return null
}

export default function NotificationPreview({ baseApi }: { baseApi: DesktopApi }) {
  const [delivered, setDelivered] = React.useState<Array<{ title: string; target?: NotificationTarget }>>([])
  const [opened, setOpened] = React.useState('尚未定位')
  const handlers = React.useRef(new Set<(event: GatewayEvent) => void>())
  const actions = React.useRef(new Set<Parameters<DesktopApi['notifications']['onAction']>[0]>())
  const sequence = React.useRef(0)
  const api = React.useMemo<DesktopApi>(() => ({
    ...baseApi,
    events: { ...baseApi.events, async onGatewayEvent(handler) { handlers.current.add(handler); return () => { handlers.current.delete(handler) } } },
    notifications: {
      async permission() { return true }, async requestPermission() { return true },
      async show(title, _body, target) { setDelivered(previous => [...previous, { title, target }]) },
      async onAction(handler) { actions.current.add(handler); return () => { actions.current.delete(handler) } },
    },
  }), [baseApi])
  const emit = (kind: string, payload: Record<string, unknown>) => {
    const event = { kind, payload, seq: ++sequence.current, profile: 'writer', session_id: 'preview-session' }
    handlers.current.forEach(handler => handler(event))
  }
  return <DesktopProvider api={api}>
    <Bridge onOpen={async (profile, session) => { setOpened(`${profile}/${session}`) }}/>
    <p>PREVIEW_ONLY · 仅记录通知，不投递系统，不连接运行时。</p>
    <button onClick={() => emit('background.complete', { task_id: 'preview-task', text: '后台任务已完成' })}>后台完成</button>
    <button onClick={() => emit('notification.show', { key: 'credits.depleted', text: '测试额度不足', level: 'error' })}>额度不足</button>
    <button onClick={() => emit('notification.clear', { key: 'credits.depleted' })}>撤销额度状态</button>
    <button onClick={() => emit('notification.show', { key: 'plugin-message:preview:1', text: '插件测试消息', level: 'info' })}>插件消息</button>
    <button onClick={() => emit('message.complete', { status: 'complete', text: '其他会话已完成' })}>其他会话完成</button>
    <button onClick={() => { const target = delivered.at(-1)?.target; if (target) actions.current.forEach(handler => handler({ kind: 'open', target })) }}>预览点击定位</button>
    <p>已记录 {delivered.length} 条；{opened}</p>
    <ul>{delivered.map((row, index) => <li key={index}>{row.title} · {row.target?.profile}/{row.target?.sessionId}</li>)}</ul>
    <NotificationsSettings page="alerts" language="zh-CN"/>
  </DesktopProvider>
}
