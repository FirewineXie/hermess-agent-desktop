import type { ChatConnectionCommand, ChatConnectionSnapshot, DesktopApi, GatewayEvent, ResumeResult } from '@hermess/contracts'
import { useProfileState } from '../../app/profile-scope/ProfileWorkspace'
import { requireSessionScope } from './chatScopes'
import { connectionSnapshot, mergeConnectionSnapshot } from './connectionState'

type Card = { session: string; profile: string; snapshot: ChatConnectionSnapshot }

export function useChatConnection(chat: DesktopApi['chat'], workspace: string, profile: string | null, session: string) {
  const [card, setCard] = useProfileState<Card | null>(workspace, null, 'chat:connection')
  const visible = card?.session === session && card.profile === profile ? card : null

  function receive(event: GatewayEvent) {
    if (event.kind !== 'connection.request' && event.kind !== 'connection.update') return false
    const snapshot = connectionSnapshot(event.payload)
    if (!snapshot || !event.session_id || !event.profile) return true
    const next = { session: event.session_id, profile: event.profile, snapshot }
    setCard(current => {
      if (current?.session === next.session && current.profile === next.profile && current.snapshot.op_id === snapshot.op_id) {
        return { ...next, snapshot: mergeConnectionSnapshot(current.snapshot, snapshot) }
      }
      return event.kind === 'connection.request' ? next : current
    })
    return true
  }

  function restore(result: ResumeResult, owner: string) {
    const snapshot = connectionSnapshot(result.pending_connection)
    setCard(current => {
      if (!snapshot) return null
      const same = current?.session === result.session_id && current.profile === owner && current.snapshot.op_id === snapshot.op_id
      return { session: result.session_id, profile: owner, snapshot: same ? mergeConnectionSnapshot(current.snapshot, snapshot) : snapshot }
    })
  }

  async function run(request: ChatConnectionCommand) {
    if (!visible || visible.snapshot.op_id !== request.op_id) return
    const result = await chat.connection({
      ...requireSessionScope(visible.profile, visible.session),
      gatewayEpoch: workspace.split('\u0000', 1)[0],
    }, request)
    const snapshot = connectionSnapshot(result)
    setCard(current => {
      if (!current || current.session !== visible.session || current.profile !== visible.profile
        || current.snapshot.op_id !== request.op_id) return current
      if (snapshot?.op_id === request.op_id) return { ...current, snapshot: mergeConnectionSnapshot(current.snapshot, snapshot) }
      if ('status' in result && result.status === 'ok' && result.settled) {
        return { ...current, snapshot: { ...current.snapshot, settled: true } }
      }
      return current
    })
  }

  return { snapshot: visible?.snapshot, receive, restore, run, dismiss: () => setCard(null) }
}
