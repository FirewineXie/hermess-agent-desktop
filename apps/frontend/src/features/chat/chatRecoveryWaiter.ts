type PendingRecovery = { epoch: string; profile: string; current: () => boolean; complete: (ok: boolean) => void }

/** The runtime owns cancellation; a pending React session restore must always settle. */
export function createChatRecoveryWaiter() {
  const waiter = {
    current: null as PendingRecovery | null,
    wait(epoch: string, profile: string, current: () => boolean) {
      waiter.cancel()
      return new Promise<boolean>(resolve => {
        const pending: PendingRecovery = {
          epoch, profile, current,
          complete: ok => { if (waiter.current === pending) waiter.current = null; resolve(ok) },
        }
        waiter.current = pending
      })
    },
    cancel() { waiter.current?.complete(false) },
  }
  return waiter
}
