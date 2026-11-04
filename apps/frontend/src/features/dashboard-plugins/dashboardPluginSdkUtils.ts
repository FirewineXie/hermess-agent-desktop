/** Relative-time helpers kept behavior-compatible with the locked Dashboard SDK. */
export function dashboardTimeAgo(timestampSeconds: number, nowMs = Date.now()): string {
  const delta = nowMs / 1000 - timestampSeconds
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  if (delta < 172800) return 'yesterday'
  return `${Math.floor(delta / 86400)}d ago`
}

export function dashboardIsoTimeAgo(iso: string, nowMs = Date.now()): string {
  const delta = (nowMs - new Date(iso).getTime()) / 1000
  if (delta < 0 || Number.isNaN(delta)) return 'unknown'
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}
