export const AUTOMATIC_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export function automaticUpdateCheckDelay(lastCheckAt: number | null, now: number): number {
  if (lastCheckAt === null || !Number.isFinite(lastCheckAt) || lastCheckAt <= 0) return 0
  if (!Number.isFinite(now) || now < lastCheckAt) return AUTOMATIC_UPDATE_CHECK_INTERVAL_MS
  return Math.max(0, AUTOMATIC_UPDATE_CHECK_INTERVAL_MS - (now - lastCheckAt))
}
