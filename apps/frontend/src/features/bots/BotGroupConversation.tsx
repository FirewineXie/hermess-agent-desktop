import React from 'react'
import type { BotGroup, BotGroupEvent } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { groupHistoryItems } from './groupEventPresentation'
import './bots.css'

type ApprovalAction = { kind: 'approval'; member_id: string; task_id: string; execution_generation: number; request_id: string; approval?: { description?: string; command?: string } }

type Props = {
  roomId: string
  connected: boolean
  language: 'zh-CN' | 'en-US'
  onDisband: () => void
}

export default function BotGroupConversation({ roomId, connected, language, onDisband }: Props) {
  const { bots } = useDesktop()
  const zh = language === 'zh-CN'
  const [room, setRoom] = React.useState<BotGroup | null>(null)
  const [events, setEvents] = React.useState<BotGroupEvent[]>([])
  const [roomStatus, setRoomStatus] = React.useState<Record<string, unknown> | null>(null)
  const [draft, setDraft] = React.useState('')
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const cursor = React.useRef(0)
  const sendAttempt = React.useRef<{ key: string; eventId: string; threadId: string } | null>(null)
  const loading = React.useRef(false)

  const load = React.useCallback(async () => {
    if (!connected || loading.current) return
    loading.current = true
    try {
      const state = await bots.groups<{ room: BotGroup; driver_status?: Record<string, unknown> }>('default', 'state', { room_id: roomId })
      const received: BotGroupEvent[] = []
      let nextCursor = cursor.current
      for (let page = 0; page < 20; page += 1) {
        const log = await bots.groups<{ events: BotGroupEvent[]; cursor: number; has_more: boolean }>('default', 'log', { room_id: roomId, since_seq: nextCursor, limit: 500 })
        received.push(...log.events)
        if (log.cursor <= nextCursor || !log.has_more) { nextCursor = log.cursor; break }
        nextCursor = log.cursor
      }
      setRoom(state.room)
      setRoomStatus(state.driver_status || null)
      cursor.current = nextCursor
      if (received.length) setEvents(current => [...new Map([...current, ...received].map(event => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq))
      setError('')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { loading.current = false }
  }, [bots, connected, language, roomId])

  React.useEffect(() => {
    if (!connected) return
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [connected, load])

  const run = async (action: string, task: () => Promise<void>) => {
    if (pending || !connected) return
    setPending(action)
    setError('')
    try { await task() } catch (cause) { setError(describeError(cause, language)) }
    finally { setPending(null) }
  }
  const send = () => void run('send', async () => {
    const text = draft.trim()
    if (!text) return
    if (sendAttempt.current?.key !== text) sendAttempt.current = { key: text, eventId: crypto.randomUUID(), threadId: crypto.randomUUID() }
    await bots.groups('default', 'send', { room_id: roomId, text, event_id: sendAttempt.current.eventId, thread_id: sendAttempt.current.threadId })
    sendAttempt.current = null
    setDraft('')
    await load()
  })
  const stop = () => void run('stop', async () => {
    await bots.groups('default', 'stop', { room_id: roomId, cancel_id: crypto.randomUUID() })
    await load()
  })
  const approve = (action: ApprovalAction, choice: 'once' | 'deny') => void run(`approve:${action.request_id}`, async () => {
    await bots.groups('default', 'approve', { room_id: roomId, member_id: action.member_id, task_id: action.task_id,
      execution_generation: action.execution_generation, request_id: action.request_id, choice })
    await load()
  })
  const disband = () => void run('disband', async () => {
    if (!window.confirm(zh ? '解散这个群聊？历史会保留在网关中。' : 'Disband this group? Its history remains in the gateway.')) return
    await bots.groups('default', 'disband', { room_id: roomId, cancel_id: crypto.randomUUID() })
    onDisband()
  })
  const approvals = ((roomStatus?.pending_actions as unknown[] | undefined) || []).filter((item): item is ApprovalAction => {
    if (!item || typeof item !== 'object') return false
    const action = item as Record<string, unknown>
    return action.kind === 'approval' && typeof action.member_id === 'string' && typeof action.task_id === 'string' && typeof action.request_id === 'string' && typeof action.execution_generation === 'number'
  })
  const memberNames = new Map(room?.members.map(member => [member.member_id, member.display_name || member.handle]) || [])
  const history = groupHistoryItems(events, zh)
  return <section className="bots-view bots-chat-view"><div className="bots-conversation bots-panel">
    <header><div><h2>{room?.name || (zh ? '加载群聊…' : 'Loading group…')}</h2><small>{room?.members.map(member => `@${member.handle}`).join(' · ')}</small></div>
      <div><button type="button" disabled={!connected || pending !== null} onClick={stop}>{zh ? '停止运行' : 'Stop'}</button><button type="button" disabled={!connected || pending !== null} onClick={disband}>{zh ? '解散' : 'Disband'}</button></div></header>
    {roomStatus && <p className="bots-room-status" role="status">{roomStatus.working ? (zh ? 'Bot 正在回复…' : 'Bots are working…') : roomStatus.blocked ? (zh ? '群聊需要处理待办操作。' : 'Group needs attention.') : (zh ? '等待消息' : 'Waiting for a message')}</p>}
    {error && <p className="bots-error" role="alert">{error} <button type="button" onClick={() => void load()}>{zh ? '重试' : 'Retry'}</button></p>}
    {approvals.map(action => <div className="bots-approval" key={action.request_id}><strong>{zh ? `${action.member_id} 请求执行操作` : `${action.member_id} requests approval`}</strong><p>{action.approval?.description || action.approval?.command || (zh ? '请检查该 Bot 的请求。' : 'Review this Bot request.')}</p><button type="button" disabled={pending !== null} onClick={() => approve(action, 'once')}>{zh ? '允许一次' : 'Allow once'}</button><button type="button" disabled={pending !== null} onClick={() => approve(action, 'deny')}>{zh ? '拒绝' : 'Deny'}</button></div>)}
    <div className="bots-events">{history.map(({ event, notice }) => <article key={`${event.seq}:${event.event_id}`}>
      {notice ? <><p role="status">{typeof event.payload.member_id === 'string' && memberNames.get(event.payload.member_id) ? `${memberNames.get(event.payload.member_id)}：` : ''}{notice}</p>
        {event.kind === 'turn.failed' && typeof event.payload.error === 'string' && event.payload.error.trim() && <details className="bots-error-detail"><summary>{zh ? '错误详情' : 'Error details'}</summary><pre>{event.payload.error.slice(0, 2000)}</pre></details>}</>
        : <><small>{event.kind === 'message.user' ? (zh ? '你' : 'You') : memberNames.get(event.actor.id) || event.actor.id}</small><p>{String(event.payload.text || event.payload.content || '')}</p></>}
    </article>)}{history.length === 0 && <p>{zh ? '发送消息开始讨论。输入 @Bot 名称可指定成员；不指定时面向所有成员。' : 'Send a message to begin. Use @Bot to target a member; otherwise address all members.'}</p>}</div>
    <div className="bots-mentions">{room?.members.map(member => <button type="button" key={member.member_id} onClick={() => setDraft(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${member.handle} `)}>@{member.handle}</button>)}</div>
    <form onSubmit={event => { event.preventDefault(); send() }}><textarea aria-label={zh ? '群聊消息' : 'Group message'} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      if (!event.repeat && connected && pending === null && draft.trim()) event.currentTarget.form?.requestSubmit()
    }} placeholder={zh ? '输入消息，可用 @Bot 指定发言者' : 'Message; use @Bot to target a speaker'} /><button type="submit" disabled={!connected || pending !== null || !draft.trim()}>{zh ? '发送' : 'Send'}</button></form>
  </div></section>
}
