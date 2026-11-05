import React from 'react'
import type { BotGroup, BotGroupCapabilities, BotGroupEvent, BotRoster } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import './bots.css'

type Props = {
  active: boolean
  connected: boolean
  language: 'zh-CN' | 'en-US'
  onOpenChat: (profile: string, sessionId: string) => void
  onOpenProfiles: () => void
}

type ApprovalAction = { kind: 'approval'; member_id: string; task_id: string; execution_generation: number; request_id: string; approval?: { description?: string; command?: string } }

const rootProfile = 'default'

export default function BotsView({ active, connected, language, onOpenChat, onOpenProfiles }: Props) {
  const { bots } = useDesktop()
  const zh = language === 'zh-CN'
  const [roster, setRoster] = React.useState<BotRoster | null>(null)
  const [capabilities, setCapabilities] = React.useState<BotGroupCapabilities | null>(null)
  const [rooms, setRooms] = React.useState<BotGroup[]>([])
  const [selectedRoom, setSelectedRoom] = React.useState<string | null>(null)
  const [events, setEvents] = React.useState<BotGroupEvent[]>([])
  const [room, setRoom] = React.useState<BotGroup | null>(null)
  const [roomStatus, setRoomStatus] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const [name, setName] = React.useState('')
  const [members, setMembers] = React.useState<string[]>([])
  const [draft, setDraft] = React.useState('')
  const requestVersion = React.useRef(0)
  const roomCursor = React.useRef({ id: '', seq: 0 })
  const createAttempt = React.useRef<{ key: string; id: string } | null>(null)
  const sendAttempt = React.useRef<{ key: string; eventId: string; threadId: string } | null>(null)
  const selectedRoomRef = React.useRef(selectedRoom)
  selectedRoomRef.current = selectedRoom

  const load = React.useCallback(async () => {
    if (!connected) return
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const [nextRoster, nextCapabilities, nextRooms] = await Promise.all([
        bots.list(),
        bots.groups<BotGroupCapabilities>(rootProfile, 'capabilities', {}),
        bots.groups<{ rooms: BotGroup[] }>(rootProfile, 'list', {}),
      ])
      if (version !== requestVersion.current) return
      setRoster(nextRoster)
      setCapabilities(nextCapabilities)
      setRooms(nextRooms.rooms.filter(item => item.disbanded_at == null))
    } catch (cause) {
      if (version === requestVersion.current) setError(describeError(cause, language))
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [bots, connected, language])

  React.useEffect(() => {
    if (active && connected) void load()
    if (!connected) { ++requestVersion.current; setRoster(null); setCapabilities(null); setRooms([]); setSelectedRoom(null); setEvents([]) }
  }, [active, connected, load])

  const loadRoom = React.useCallback(async (id: string) => {
    try {
      if (roomCursor.current.id !== id) { roomCursor.current = { id, seq: 0 }; setEvents([]) }
      const state = await bots.groups<{ room: BotGroup; driver_status?: Record<string, unknown> }>(rootProfile, 'state', { room_id: id })
      const received: BotGroupEvent[] = []
      let cursor = roomCursor.current.seq
      for (let page = 0; page < 20; page += 1) {
        const log = await bots.groups<{ events: BotGroupEvent[]; cursor: number; has_more: boolean }>(rootProfile, 'log', { room_id: id, since_seq: cursor, limit: 500 })
        received.push(...log.events)
        if (log.cursor <= cursor || !log.has_more) { cursor = log.cursor; break }
        cursor = log.cursor
      }
      if (selectedRoomRef.current !== id) return
      setRoom(state.room)
      setRoomStatus(state.driver_status || null)
      roomCursor.current = { id, seq: cursor }
      if (received.length) setEvents(current => [...new Map([...current, ...received].map(event => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq))
    } catch (cause) { setError(describeError(cause, language)) }
  }, [bots, language])

  React.useEffect(() => {
    if (!active || !connected || !selectedRoom) return
    void loadRoom(selectedRoom)
    const timer = window.setInterval(() => void loadRoom(selectedRoom), 3000)
    return () => window.clearInterval(timer)
  }, [active, connected, selectedRoom, loadRoom])

  const run = async (action: string, task: () => Promise<void>) => {
    if (pending) return
    setPending(action)
    setError('')
    try { await task() } catch (cause) { setError(describeError(cause, language)) } finally { setPending(null) }
  }

  const openChat = (profile: string) => void run(`chat:${profile}`, async () => {
    const result = await bots.openChat(profile)
    onOpenChat(profile, result.session_id)
  })

  const createRoom = () => void run('create', async () => {
    const trimmed = name.trim()
    if (!trimmed || members.length < 2 || members.length > 6) throw new Error(zh ? '群聊需要名称和 2 至 6 个 Bot。' : 'A group needs a name and 2 to 6 Bots.')
    const key = JSON.stringify([trimmed, members])
    if (createAttempt.current?.key !== key) createAttempt.current = { key, id: crypto.randomUUID() }
    const selected = members.map(profile => {
      const row = roster?.profiles.find(item => item.name === profile)
      return { member_id: profile, profile, handle: profile === 'default' ? 'hermes' : profile, display_name: row?.display_name || profile }
    })
    const result = await bots.groups<{ room: BotGroup }>(rootProfile, 'create', { room_id: createAttempt.current.id, name: trimmed, members: selected })
    createAttempt.current = null
    setName('')
    setMembers([])
    await load()
    setSelectedRoom(result.room.room_id)
  })

  const send = () => void run('send', async () => {
    if (!selectedRoom || !draft.trim()) return
    const key = JSON.stringify([selectedRoom, draft.trim()])
    if (sendAttempt.current?.key !== key) sendAttempt.current = { key, eventId: crypto.randomUUID(), threadId: crypto.randomUUID() }
    await bots.groups(rootProfile, 'send', { room_id: selectedRoom, text: draft.trim(), event_id: sendAttempt.current.eventId, thread_id: sendAttempt.current.threadId })
    sendAttempt.current = null
    setDraft('')
    await loadRoom(selectedRoom)
  })

  const stop = () => void run('stop', async () => {
    if (!selectedRoom) return
    await bots.groups(rootProfile, 'stop', { room_id: selectedRoom, cancel_id: crypto.randomUUID() })
    await loadRoom(selectedRoom)
  })

  const approve = (action: ApprovalAction, choice: 'once' | 'deny') => void run(`approve:${action.request_id}`, async () => {
    if (!selectedRoom) return
    await bots.groups(rootProfile, 'approve', { room_id: selectedRoom, member_id: action.member_id, task_id: action.task_id,
      execution_generation: action.execution_generation, request_id: action.request_id, choice })
    await loadRoom(selectedRoom)
  })

  const disband = () => void run('disband', async () => {
    if (!selectedRoom || !window.confirm(zh ? '解散这个群聊？历史会保留在网关中。' : 'Disband this group? Its history remains in the gateway.')) return
    await bots.groups(rootProfile, 'disband', { room_id: selectedRoom, cancel_id: crypto.randomUUID() })
    setSelectedRoom(null)
    roomCursor.current = { id: '', seq: 0 }
    setRoom(null)
    setEvents([])
    await load()
  })

  const eligible = roster?.profiles.filter(item => capabilities?.seatable_profiles?.includes(item.name)) || []
  const approvals = ((roomStatus?.pending_actions as unknown[] | undefined) || []).filter((item): item is ApprovalAction => {
    if (!item || typeof item !== 'object') return false
    const action = item as Record<string, unknown>
    return action.kind === 'approval' && typeof action.member_id === 'string' && typeof action.task_id === 'string' && typeof action.request_id === 'string' && typeof action.execution_generation === 'number'
  })
  return <main className="bots-view">
    <header className="bots-header"><div><span className="bots-eyebrow">HERMESS · BOT</span><h1>{zh ? 'Bot 模式' : 'Bot Mode'}</h1><p>{zh ? '与单个 Bot 对话，或让多个 Bot 在群聊中协作。' : 'Chat with one Bot or bring several Bots together in a group.'}</p></div><div className="bots-actions"><button type="button" disabled={!connected || loading} onClick={() => void load()}>{loading ? '…' : zh ? '刷新' : 'Refresh'}</button><button type="button" onClick={onOpenProfiles}>{zh ? '管理 Bot' : 'Manage Bots'}</button></div></header>
    {!connected && <p role="status">{zh ? '请先启动本地 Gateway。' : 'Start the local Gateway first.'}</p>}
    {error && <p className="bots-error" role="alert">{error} <button type="button" onClick={() => void load()}>{zh ? '重试' : 'Retry'}</button></p>}
    {connected && <div className="bots-columns"><section className="bots-panel">
      <div className="bots-panel-heading"><div><span className="bots-section-index">01 · {zh ? '单独对话' : 'One-to-one'}</span><h2>{zh ? '选择 Bot' : 'Choose a Bot'}</h2></div><span className="bots-panel-count">{roster?.profiles.length ?? 0} Bot</span></div>
      <p className="bots-hint">{zh
        ? '每个 Bot 都有自己的固定聊天。打开后可直接交代任务，也可用 @ID 请它联系其他 Bot。'
        : 'Each Bot has a dedicated chat. Give it a task, or use @ID to ask it to contact another Bot.'}</p>
      {roster?.profiles.map(bot => <div className="bot-row" key={bot.name}>
        <div><strong>{bot.display_name || bot.name}</strong><small>@{bot.name === 'default' ? 'hermes' : bot.name}</small>{bot.description && <p>{bot.description}</p>}</div>
        <button type="button" disabled={pending !== null || !capabilities?.seatable_profiles?.includes(bot.name)} onClick={() => openChat(bot.name)}>
          {!capabilities?.seatable_profiles?.includes(bot.name) ? (zh ? '待启用' : 'Unavailable') : pending === `chat:${bot.name}` ? '…' : zh ? '打开聊天' : 'Open chat'}
        </button>
      </div>)}
      {roster && roster.profiles.length === 0 && <p>{zh ? '没有可用 Bot。' : 'No Bots available.'}</p>}
    </section>
    <section className="bots-panel"><div className="bots-panel-heading"><div><span className="bots-section-index">02 · {zh ? '多人协作' : 'Collaboration'}</span><h2>{zh ? '创建群聊' : 'Create a group'}</h2></div><span className="bots-panel-count">{rooms.length} {zh ? '个群聊' : 'groups'}</span></div>
      <p className="bots-hint">{zh ? '选 2–6 个 Bot；群聊中用 @ID 指定回复者，不指定时所有成员都会回复。' : 'Choose 2–6 Bots. Use @ID to target one; otherwise all members reply.'}</p>
      {!capabilities?.driver && <p className="bots-warning" role="status">{zh ? '当前 Gateway 尚未启动群聊执行器。' : 'The group driver is unavailable.'}</p>}
      <div className="bots-create"><label className="bots-field">{zh ? '群聊名称' : 'Group name'}<input aria-label={zh ? '群聊名称' : 'Group name'} value={name} maxLength={80} placeholder={zh ? '例如：产品方案讨论' : 'For example: Product planning'} onChange={event => setName(event.target.value)} /></label>
        <div className="bots-member-field"><span>{zh ? `选择成员 · 已选 ${members.length}/6` : `Members · ${members.length}/6 selected`}</span><div className="bots-member-picker">{eligible.map(bot => <label className={members.includes(bot.name) ? 'selected' : ''} key={bot.name}><input type="checkbox" checked={members.includes(bot.name)} disabled={pending !== null || (!members.includes(bot.name) && members.length >= 6)} onChange={event => setMembers(current => event.target.checked ? [...current, bot.name] : current.filter(name => name !== bot.name))} />{bot.display_name || bot.name}</label>)}</div></div>
        <div className="bots-create-actions"><span>{zh ? '至少选择 2 个 Bot' : 'Select at least 2 Bots'}</span><button type="button" disabled={!capabilities?.driver || pending !== null || members.length < 2 || !name.trim()} onClick={createRoom}>{zh ? '创建群聊' : 'Create group'}</button></div></div>
      <div className="bots-room-list"><h3>{zh ? '已有群聊' : 'Your groups'}</h3>{rooms.map(item => <button type="button" key={item.room_id} className={selectedRoom === item.room_id ? 'selected' : ''} onClick={() => setSelectedRoom(item.room_id)}>{item.name} <small>{item.members.length} Bot</small></button>)}{rooms.length === 0 && <p>{zh ? '还没有群聊。创建后可在这里继续讨论。' : 'No groups yet. Create one to start a discussion.'}</p>}</div>
    </section>
    {selectedRoom && <section className="bots-panel bots-conversation"><header><div><h2>{room?.name || (zh ? '加载中…' : 'Loading…')}</h2><small>{room?.members.map(member => `@${member.handle}`).join(' · ')}</small></div><div><button type="button" disabled={pending !== null} onClick={stop}>{zh ? '停止运行' : 'Stop'}</button><button type="button" disabled={pending !== null} onClick={disband}>{zh ? '解散' : 'Disband'}</button></div></header>
      {roomStatus && <p className="bots-room-status" role="status">{roomStatus.working ? (zh ? 'Bot 正在回复…' : 'Bots are working…') : roomStatus.blocked ? (zh ? '群聊需要处理待办操作。' : 'Group needs attention.') : (zh ? '等待消息' : 'Waiting for a message')}</p>}
      {approvals.map(action => <div className="bots-approval" key={action.request_id}><strong>{zh ? `${action.member_id} 请求执行操作` : `${action.member_id} requests approval`}</strong><p>{action.approval?.description || action.approval?.command || (zh ? '请检查该 Bot 的请求。' : 'Review this Bot request.')}</p><button type="button" disabled={pending !== null} onClick={() => approve(action, 'once')}>{zh ? '允许一次' : 'Allow once'}</button><button type="button" disabled={pending !== null} onClick={() => approve(action, 'deny')}>{zh ? '拒绝' : 'Deny'}</button></div>)}
      <div className="bots-events">{events.map(event => <article key={`${event.seq}:${event.event_id}`}><small>{event.kind === 'message.user' ? (zh ? '你' : 'You') : event.actor.id} · #{event.seq}</small><p>{String(event.payload.text || (event.kind === 'message.member' ? '' : event.kind))}</p></article>)}{events.length === 0 && <p>{zh ? '发送消息开始讨论。输入 @Bot 名称可指定成员；不指定时全部成员回复。' : 'Send a message to begin. Use @Bot to target a member; otherwise all reply.'}</p>}</div>
      <div className="bots-mentions">{room?.members.map(member => <button type="button" key={member.member_id} onClick={() => setDraft(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${member.handle} `)}>@{member.handle}</button>)}</div>
      <form onSubmit={event => { event.preventDefault(); send() }}><textarea aria-label={zh ? '群聊消息' : 'Group message'} value={draft} onChange={event => setDraft(event.target.value)} placeholder={zh ? '输入消息，使用 @Bot 指定发言者' : 'Message; use @Bot to target a speaker'} /><button type="submit" disabled={pending !== null || !draft.trim()}>{zh ? '发送' : 'Send'}</button></form>
    </section>}
    </div>}
  </main>
}
