import React from 'react'
import type { BackendInfo } from '@hermess/contracts'

export function useRetryRefresh(
  pending: { current: string }, busy: boolean, navigationBusy: boolean,
  backend: BackendInfo | null, sessionId: string,
  storedSession: { current: string }, owner: { current: string },
  resume: (id: string, force: boolean, epoch: string, profile: string) => Promise<boolean>,
) {
  React.useEffect(() => {
    if (!pending.current) return
    if (pending.current !== sessionId) { pending.current = ''; return }
    if (busy || navigationBusy || !backend || !owner.current) return
    pending.current = ''
    void resume(storedSession.current || sessionId, true, backend.replay_epoch || '', owner.current)
  }, [busy, navigationBusy, backend?.replay_epoch, sessionId, pending.current])
}
