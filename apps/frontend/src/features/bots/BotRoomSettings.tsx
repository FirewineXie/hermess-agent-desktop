import React from 'react'
import type { BotGroupMember } from '@hermess/contracts'

export type RoomContext = {
  purpose: string; notes: string; routing: 'everyone' | 'lead' | 'auto'; lead_member_id: string
}

export default function BotRoomSettings({ context, members, modes, zh, busy, disabled, error, onSave, onClose }: {
  context: RoomContext; members: BotGroupMember[]; modes: string[]; zh: boolean; busy: boolean; disabled: boolean; error: string
  onSave: (value: RoomContext) => void; onClose: () => void
}) {
  const [draft, setDraft] = React.useState(context)
  const dialog = React.useRef<HTMLDialogElement>(null)
  React.useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const routingLabels = zh ? { everyone: '所有成员', lead: '主 Bot 分配', auto: 'Gateway 自动分配' }
    : { everyone: 'Everyone', lead: 'Lead Bot assigns', auto: 'Gateway assigns automatically' }
  const routingModes = (Object.keys(routingLabels) as Array<RoomContext['routing']>).filter(mode => modes.includes(mode) || mode === draft.routing)
  const notesTooLong = new TextEncoder().encode(draft.notes).length > 4096
  const dismiss = () => { dialog.current?.close(); onClose() }

  return <dialog ref={dialog} className="bots-room-dialog" aria-labelledby="bots-room-settings-title" onCancel={event => {
    event.preventDefault()
    if (!busy) dismiss()
  }}><form className="bots-room-settings" onSubmit={event => {
    event.preventDefault()
    if (disabled || notesTooLong) return
    onSave({ ...draft, lead_member_id: draft.routing === 'lead' ? draft.lead_member_id : '' })
  }}>
    <h2 id="bots-room-settings-title">{zh ? '群聊设置' : 'Room settings'}</h2>
    <label className="bots-field">{zh ? '群聊目的' : 'Room purpose'}
      <input maxLength={500} value={draft.purpose} onChange={event => setDraft({ ...draft, purpose: event.target.value })} />
    </label>
    <label className="bots-field">{zh ? '共享笔记' : 'Shared notes'}
      <textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} />
    </label>
    {notesTooLong && <small role="alert">{zh ? '共享笔记最多 4096 字节。' : 'Shared notes may use up to 4096 bytes.'}</small>}
    <label className="bots-field">{zh ? '未指定成员时' : 'When no member is mentioned'}
      <select value={draft.routing} onChange={event => setDraft({ ...draft, routing: event.target.value as RoomContext['routing'] })}>
        {routingModes.map(mode => <option value={mode} key={mode}>{routingLabels[mode]}</option>)}
      </select>
    </label>
    {draft.routing === 'lead' && <label className="bots-field">{zh ? '主 Bot' : 'Lead Bot'}
      <select required value={draft.lead_member_id} onChange={event => setDraft({ ...draft, lead_member_id: event.target.value })}>
        <option value="">{zh ? '请选择成员' : 'Select a member'}</option>
        {members.map(member => <option key={member.member_id} value={member.member_id}>{member.display_name || member.handle}</option>)}
      </select>
    </label>}
    {error && <p className="bots-error" role="alert">{error}</p>}
    <div className="bots-room-dialog-actions"><button type="button" className="dialog-secondary-action" disabled={busy} onClick={dismiss}>{zh ? '取消' : 'Cancel'}</button>
      <button type="submit" className="dialog-primary-action" disabled={disabled || notesTooLong}>{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存群聊设置' : 'Save room settings')}</button></div>
  </form></dialog>
}
