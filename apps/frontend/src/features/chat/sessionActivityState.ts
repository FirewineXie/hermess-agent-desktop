export type SessionActivity = 'running' | 'completed' | 'failed' | 'approval' | 'suggestion'

export function terminalActivity(viewed: boolean, failed: boolean): SessionActivity | undefined {
  return viewed ? undefined : failed ? 'failed' : 'completed'
}

export function snapshotActivity(previous: SessionActivity | undefined, running: boolean,
  viewed: boolean, turnBusy: boolean, idleSnapshots: number): SessionActivity | undefined {
  if (viewed && turnBusy) return 'running'
  if (running && previous !== 'completed' && previous !== 'failed' && !(viewed && !turnBusy)) return 'running'
  if (previous === 'running' && idleSnapshots >= 2) return undefined
  return previous
}
