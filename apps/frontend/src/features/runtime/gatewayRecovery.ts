export type ConnectionState = 'stopped' | 'connected' | 'reconnecting' | 'disconnected'

export function gatewayRecoveryBudget(remote: boolean): number {
  // Local restart: Rust 60s + profile RPC 30s + status HTTP 8s + resume RPC 30s + UI margin.
  return remote ? 60_000 : 135_000
}

type Options<T> = {
  connect: (manualRetry: boolean) => Promise<T>
  restore: (value: T, current: () => boolean) => Promise<void>
  started: () => void
  completed: () => void
  failed: (cause: unknown) => void
  retired?: () => void
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
  budget?: number | (() => number)
  retryTransport?: boolean | (() => boolean)
}

/** One recovery owner. Every late native/session result checks its retired operation. */
export function createGatewayRecovery<T>(options: Options<T>) {
  const now = options.now || Date.now
  const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  let pending: { promise: Promise<void>; cancel: () => void } | null = null
  const cancel = () => pending?.cancel()
  const run = (manualRetry = false): Promise<void> => {
    if (pending) return pending.promise
    const budget = typeof options.budget === 'function' ? options.budget() : options.budget ?? 60_000
    const deadline = now() + budget
    let active = true
    const current = () => active && now() < deadline
    let settle: () => void = () => {}
    const promise = new Promise<void>(resolve => { settle = resolve })
    const finish = (result: 'completed' | 'failed' | 'cancelled', cause?: unknown) => {
      if (!active) return
      active = false
      clearTimeout(timer)
      if (pending?.promise === promise) pending = null
      if (result === 'completed') options.completed()
      else {
        options.retired?.()
        if (result === 'failed') options.failed(cause)
      }
      settle()
    }
    const timer = setTimeout(() => finish('failed', new Error('Gateway recovery timed out')), budget)
    pending = { promise, cancel: () => finish('cancelled') }
    options.started()
    void (async () => {
      let attempt = 0
      let firstConnection = true
      while (current()) {
        let failure: unknown
        try {
          const manual = manualRetry && firstConnection
          firstConnection = false
          const value = await options.connect(manual)
          if (!current()) return
          await options.restore(value, current)
          if (current()) finish('completed')
          return
        } catch (cause) {
          failure = cause
          if (!current()) return
          // Local transport recovery is owned by Rust; never stack another retry loop on it.
          const retryTransport = typeof options.retryTransport === 'function' ? options.retryTransport() : options.retryTransport
          if (!retryTransport) { finish('failed', failure); return }
        }
        const remaining = deadline - now()
        if (remaining <= 0) { finish('failed', failure); return }
        await wait(Math.min(500 * 2 ** Math.min(attempt++, 4), 5_000, remaining))
        if (now() >= deadline) { finish('failed', failure); return }
      }
    })()
    return promise
  }
  return { run, cancel }
}
