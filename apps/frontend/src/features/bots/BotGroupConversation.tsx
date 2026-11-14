import React from 'react'
import type { BotGroup, BotGroupEvent } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { continuableCaps, groupHistoryItems } from './groupEventPresentation'
import BotRoomSettings, { type RoomContext } from './BotRoomSettings'
import './bots.css'

type ApprovalAction = { kind: 'approval'; member_id: string; task_id: string; execution_generation: number; request_id: string; approval?: { description?: string; command?: string } }
type MemberActivity = { member_id: string; status: string; tool?: string | null; round_index?: number | null }
type RoomDriver = { working: boolean; blocked: boolean; pending_actions?: unknown[]; routing_modes?: string[]; max_continues?: number; member_activity?: MemberActivity[] }

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
  const [roomStatus, setRoomStatus] = React.useState<RoomDriver | null>(null)
  const [context, setContext] = React.useState<RoomContext | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsError, setSettingsError] = React.useState('')
  const [draft, setDraft] = React.useState('')
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const cursor = React.useRef(0)
  const sendAttempt = React.useRef<{ key: string; eventId: string; threadId: string } | null>(null)
  const loading = React.useRef(false)
  const settingsTrigger = React.useRef<HTMLButtonElement>(null)
  const restoreSettingsFocus = React.useRef(false)

  React.useEffect(() => {
    if (settingsOpen || pending !== null || !restoreSettingsFocus.current) return
    restoreSettingsFocus.current = false
    settingsTrigger.current?.focus()
  }, [settingsOpen, pending])

  const load = React.useCallback(async () => {
    if (!connected || loading.current) return
    loading.current = true
    try {
      const state = await bots.groups<{ room: BotGroup; driver_status?: RoomDriver; context?: RoomContext }>('default', 'state', { room_id: roomId })
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
      setContext(state.context || null)
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

  const run = async (action: string, task: () => Promise<void>, reportError = setError) => {
    if (pending || !connected) return
    setPending(action)
    reportError('')
    try { await task() } catch (cause) { reportError(describeError(cause, language)) }
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
  const closeSettings = () => { restoreSettingsFocus.current = true; setSettingsOpen(false) }
  const saveContext = (draft: RoomContext) => void run('context', async () => {
    const result = await bots.groups<{ context: RoomContext }>('default', 'context', { room_id: roomId, event_id: crypto.randomUUID(), ...draft })
    setContext(result.context)
    closeSettings()
    await load()
  }, setSettingsError)
  const continueDiscussion = (discussion: string) => void run('continue', async () => {
    const result = await bots.groups<{ continued: boolean; event: BotGroupEvent }>('default', 'continue', { room_id: roomId, discussion_event_id: discussion })
    if (result.continued) setEvents(current => [...new Map([...current, result.event].map(event => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq))
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
  const approvals = (roomStatus?.pending_actions || []).filter((item): item is ApprovalAction => {
    if (!item || typeof item !== 'object') return false
    const action = item as Record<string, unknown>
    return action.kind === 'approval' && typeof action.member_id === 'string' && typeof action.task_id === 'string' && typeof action.request_id === 'string' && typeof action.execution_generation === 'number'
  })
  const memberNames = new Map(room?.members.map(member => [member.member_id, member.display_name || member.handle]) || [])
  const history = groupHistoryItems(events, zh)
  const caps = continuableCaps(events, roomStatus?.max_continues ?? 0)
  const activity = new Map(roomStatus?.member_activity?.map(item => [item.member_id, item]) || [])
  const activityLabels: Record<string, string> = zh ? { queued: '排队', running: '运行中', stopping: '正在停止' }
    : { queued: 'Queued', running: 'Running', stopping: 'Stopping' }
  return <section className="bots-view bots-chat-view"><div className="bots-conversation bots-panel">
    <header><div><h2>{room?.name || (zh ? '加载群聊…' : 'Loading group…')}</h2><small>{room?.members.map(member => `@${member.handle}`).join(' · ')}</small></div>
      <div>{context && <button ref={settingsTrigger} type="button" disabled={!connected || pending !== null} aria-haspopup="dialog" onClick={() => { setSettingsError(''); setSettingsOpen(true) }}>{zh ? '群聊设置' : 'Room settings'}</button>}
        <button type="button" disabled={!connected || pending !== null} onClick={stop}>{zh ? '停止运行' : 'Stop'}</button><button type="button" disabled={!connected || pending !== null} onClick={disband}>{zh ? '解散' : 'Disband'}</button></div></header>
    {settingsOpen && context && room && <BotRoomSettings context={context} members={room.members} modes={roomStatus?.routing_modes || ['everyone', 'lead']} zh={zh} busy={pending === 'context'} disabled={!connected || pending !== null} error={settingsError} onSave={saveContext} onClose={closeSettings} />}
    {roomStatus && <p className="bots-room-status" role="status">{roomStatus.working ? (zh ? 'Bot 正在回复…' : 'Bots are working…') : roomStatus.blocked ? (zh ? '群聊需要处理待办操作。' : 'Group needs attention.') : (zh ? '等待消息' : 'Waiting for a message')}</p>}
    {roomStatus?.member_activity && <ul className="bots-member-activity" aria-label={zh ? '成员实时状态' : 'Live member status'}>
      {room?.members.map(member => {
        const state = activity.get(member.member_id)
        return <li key={member.member_id}>{member.display_name || member.handle} · {state ? activityLabels[state.status] || state.status : (zh ? '空闲' : 'Idle')}{state?.tool ? ` · ${state.tool}` : ''}</li>
      })}
    </ul>}
    {error && <p className="bots-error" role="alert">{error} <button type="button" onClick={() => void load()}>{zh ? '重试' : 'Retry'}</button></p>}
    {approvals.map(action => <div className="bots-approval" key={action.request_id}><strong>{zh ? `${action.member_id} 请求执行操作` : `${action.member_id} requests approval`}</strong><p>{action.approval?.description || action.approval?.command || (zh ? '请检查该 Bot 的请求。' : 'Review this Bot request.')}</p><button type="button" disabled={pending !== null} onClick={() => approve(action, 'once')}>{zh ? '允许一次' : 'Allow once'}</button><button type="button" disabled={pending !== null} onClick={() => approve(action, 'deny')}>{zh ? '拒绝' : 'Deny'}</button></div>)}
    <div className="bots-events">{history.map(({ event, notice }) => <article key={`${event.seq}:${event.event_id}`}>
      {notice ? <><p role="status">{typeof event.payload.member_id === 'string' && memberNames.get(event.payload.member_id) ? `${memberNames.get(event.payload.member_id)}：` : ''}{notice}</p>
        {caps.has(event.event_id) && typeof event.payload.discussion_event_id === 'string' && <button type="button" disabled={!connected || pending !== null} onClick={() => continueDiscussion(String(event.payload.discussion_event_id))}>{zh ? '继续讨论' : 'Continue discussion'}</button>}
        {event.kind === 'turn.failed' && typeof event.payload.error === 'string' && event.payload.error.trim() && <details className="bots-error-detail"><summary>{zh ? '错误详情' : 'Error details'}</summary><pre>{event.payload.error.slice(0, 2000)}</pre></details>}</>
        : <><small>{event.kind === 'message.user' && !event.actor.id.startsWith('cron:') ? (zh ? '你' : 'You') : event.actor.display_name || memberNames.get(event.actor.id) || event.actor.id}</small><p>{String(event.payload.text || event.payload.content || '')}</p></>}
    </article>)}{history.length === 0 && <p>{zh ? '发送消息开始讨论。输入 @Bot 名称可指定成员；不指定时面向所有成员。' : 'Send a message to begin. Use @Bot to target a member; otherwise address all members.'}</p>}</div>
    <div className="bots-mentions">{room?.members.map(member => <button type="button" key={member.member_id} onClick={() => setDraft(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${member.handle} `)}>@{member.handle}</button>)}</div>
    <form onSubmit={event => { event.preventDefault(); send() }}><textarea aria-label={zh ? '群聊消息' : 'Group message'} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      if (!event.repeat && connected && pending === null && draft.trim()) event.currentTarget.form?.requestSubmit()
    }} placeholder={zh ? '输入消息，可用 @Bot 指定发言者' : 'Message; use @Bot to target a speaker'} /><button type="submit" disabled={!connected || pending !== null || !draft.trim()}>{zh ? '发送' : 'Send'}</button></form>
  </div></section>
}
