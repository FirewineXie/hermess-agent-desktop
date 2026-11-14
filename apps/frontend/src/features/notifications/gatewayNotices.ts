import type { GatewayNotice } from '@hermess/contracts'

export type GatewayNoticeItem = Omit<GatewayNotice, 'text'> & { text: string; unread: boolean }
export type GatewayNoticeAction =
  | { type: 'receive'; notice: GatewayNotice }
  | { type: 'read'; gatewayId: string | null }
  | { type: 'retain'; gatewayIds: string[] }

export function gatewayNotices(state: GatewayNoticeItem[], action: GatewayNoticeAction): GatewayNoticeItem[] {
  if (action.type === 'retain') {
    return state.filter(item => item.gatewayId === null || action.gatewayIds.includes(item.gatewayId))
  }
  if (action.type === 'read') {
    return state.map(item => item.gatewayId === action.gatewayId && item.unread ? { ...item, unread: false } : item)
  }
  const { gatewayId, id, text } = action.notice
  const existing = state.find(item => item.gatewayId === gatewayId && item.id === id)
  if (existing?.text === text) return state
  const rest = state.filter(item => item !== existing)
  return text === null ? rest : [{ gatewayId, id, text, unread: true }, ...rest].slice(0, 100)
}
