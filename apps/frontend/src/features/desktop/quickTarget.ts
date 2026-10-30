import type { QuickTarget } from '@hermess/contracts'
export function sameQuickTarget(a: QuickTarget | null, b: QuickTarget): boolean {
  return Boolean(a && !a.busy && !b.busy && a.profile === b.profile && a.sessionId === b.sessionId && a.epoch === b.epoch)
}
