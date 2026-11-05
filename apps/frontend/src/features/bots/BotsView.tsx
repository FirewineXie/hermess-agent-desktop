import React from 'react'
import type { BotGroup, BotGroupCapabilities, BotRoster } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import './bots.css'

type Props = {
  active: boolean
  connected: boolean
  language: 'zh-CN' | 'en-US'
  onOpenChat: (profile: string, sessionId: string) => void
  onOpenGroup: (roomId: string) => void
  onGroupsChanged: () => void
  onOpenProfiles: () => void
}

export default function BotsView({ active, connected, language, onOpenChat, onOpenGroup, onGroupsChanged, onOpenProfiles }: Props) {
  const { bots } = useDesktop()
  const zh = language === 'zh-CN'
  const [roster, setRoster] = React.useState<BotRoster | null>(null)
  const [capabilities, setCapabilities] = React.useState<BotGroupCapabilities | null>(null)
  const [rooms, setRooms] = React.useState<BotGroup[]>([])
  const [loading, setLoading] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const [name, setName] = React.useState('')
  const [members, setMembers] = React.useState<string[]>([])
  const requestVersion = React.useRef(0)
  const createAttempt = React.useRef<{ key: string; id: string } | null>(null)

  const load = React.useCallback(async () => {
    if (!connected) return
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const [nextRoster, nextCapabilities, nextRooms] = await Promise.all([
        bots.list(),
        bots.groups<BotGroupCapabilities>('default', 'capabilities', {}),
        bots.groups<{ rooms: BotGroup[] }>('default', 'list', {}),
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
    if (!connected) { ++requestVersion.current; setRoster(null); setCapabilities(null); setRooms([]) }
  }, [active, connected, load])

  const run = async (action: string, task: () => Promise<void>) => {
    if (pending) return
    setPending(action)
    setError('')
    try { await task() } catch (cause) { setError(describeError(cause, language)) }
    finally { setPending(null) }
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
    const result = await bots.groups<{ room: BotGroup }>('default', 'create', { room_id: createAttempt.current.id, name: trimmed, members: selected })
    createAttempt.current = null
    setName('')
    setMembers([])
    onGroupsChanged()
    onOpenGroup(result.room.room_id)
  })
  const eligible = roster?.profiles.filter(item => capabilities?.seatable_profiles?.includes(item.name)) || []
  return <main className="bots-view">
    <header className="bots-header"><div><span className="bots-eyebrow">HERMESS · BOT</span><h1>{zh ? 'Bot 模式' : 'Bot Mode'}</h1><p>{zh ? '与单个 Bot 对话，或让多个 Bot 在群聊中协作。' : 'Chat with one Bot or bring several Bots together in a group.'}</p></div><div className="bots-actions"><button type="button" disabled={!connected || loading} onClick={() => void load()}>{loading ? '…' : zh ? '刷新' : 'Refresh'}</button><button type="button" onClick={onOpenProfiles}>{zh ? '管理 Bot' : 'Manage Bots'}</button></div></header>
    {!connected && <p role="status">{zh ? '请先启动本地 Gateway。' : 'Start the local Gateway first.'}</p>}
    {error && <p className="bots-error" role="alert">{error} <button type="button" onClick={() => void load()}>{zh ? '重试' : 'Retry'}</button></p>}
    {connected && <div className="bots-columns"><section className="bots-panel">
      <div className="bots-panel-heading"><div><span className="bots-section-index">01 · {zh ? '单独对话' : 'One-to-one'}</span><h2>{zh ? '选择 Bot' : 'Choose a Bot'}</h2></div><span className="bots-panel-count">{roster?.profiles.length ?? 0} Bot</span></div>
      <p className="bots-hint">{zh ? '每个 Bot 都有自己的固定聊天。打开后可直接交代任务，也可用 @ID 请它联系其他 Bot。' : 'Each Bot has a dedicated chat. Give it a task, or use @ID to ask it to contact another Bot.'}</p>
      {roster?.profiles.map(bot => <div className="bot-row" key={bot.name}><div><strong>{bot.display_name || bot.name}</strong><small>@{bot.name === 'default' ? 'hermes' : bot.name}</small>{bot.description && <p>{bot.description}</p>}</div><button type="button" disabled={pending !== null || !capabilities?.seatable_profiles?.includes(bot.name)} onClick={() => openChat(bot.name)}>{!capabilities?.seatable_profiles?.includes(bot.name) ? (zh ? '待启用' : 'Unavailable') : pending === `chat:${bot.name}` ? '…' : zh ? '打开聊天' : 'Open chat'}</button></div>)}
      {roster && roster.profiles.length === 0 && <p>{zh ? '没有可用 Bot。' : 'No Bots available.'}</p>}
    </section><section className="bots-panel"><div className="bots-panel-heading"><div><span className="bots-section-index">02 · {zh ? '多人协作' : 'Collaboration'}</span><h2>{zh ? '创建群聊' : 'Create a group'}</h2></div><span className="bots-panel-count">{rooms.length} {zh ? '个群聊' : 'groups'}</span></div>
      <p className="bots-hint">{zh ? '选 2–6 个 Bot；群聊中用 @ID 指定回复者，不指定时所有成员都可回复。' : 'Choose 2–6 Bots. Use @ID to target one; otherwise all members can reply.'}</p>
      {!capabilities?.driver && <p className="bots-warning" role="status">{zh ? '当前 Gateway 尚未启动群聊执行器。' : 'The group driver is unavailable.'}</p>}
      <div className="bots-create"><label className="bots-field">{zh ? '群聊名称' : 'Group name'}<input aria-label={zh ? '群聊名称' : 'Group name'} value={name} maxLength={80} placeholder={zh ? '例如：产品方案讨论' : 'For example: Product planning'} onChange={event => setName(event.target.value)} /></label>
        <div className="bots-member-field"><span>{zh ? `选择成员 · 已选 ${members.length}/6` : `Members · ${members.length}/6 selected`}</span><div className="bots-member-picker">{eligible.map(bot => <label className={members.includes(bot.name) ? 'selected' : ''} key={bot.name}><input type="checkbox" checked={members.includes(bot.name)} disabled={pending !== null || (!members.includes(bot.name) && members.length >= 6)} onChange={event => setMembers(current => event.target.checked ? [...current, bot.name] : current.filter(name => name !== bot.name))} />{bot.display_name || bot.name}</label>)}</div></div>
        <div className="bots-create-actions"><span>{zh ? '至少选择 2 个 Bot' : 'Select at least 2 Bots'}</span><button type="button" disabled={!capabilities?.driver || pending !== null || members.length < 2 || !name.trim()} onClick={createRoom}>{zh ? '创建群聊' : 'Create group'}</button></div></div>
      <div className="bots-room-list"><h3>{zh ? '已有群聊' : 'Your groups'}</h3>{rooms.map(item => <button type="button" key={item.room_id} onClick={() => onOpenGroup(item.room_id)}>{item.name} <small>{item.members.length} Bot</small></button>)}{rooms.length === 0 && <p>{zh ? '还没有群聊。创建后可在这里继续讨论。' : 'No groups yet. Create one to start a discussion.'}</p>}</div>
    </section></div>}
  </main>
}
