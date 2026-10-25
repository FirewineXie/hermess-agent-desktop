import type { UsageStatistics } from '@hermess/contracts'

type DailyRow = UsageStatistics['daily'][number]
export type ChartPoint = { day: string; input: number; output: number; reasoning: number }

const DAY_MS = 86_400_000

function count(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

// The API groups full session totals under the session's local start date.
export function usageChartPoints(daily: DailyRow[], days: number, today: string): ChartPoint[] {
  const end = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(end)) return []
  const recentStart = end - (days - 1) * DAY_MS
  const rows = new Map(daily.map(row => [row.day, row]))
  const earliest = daily.reduce((first, row) => row.day < first ? row.day : first, today)
  const firstDay = Date.parse(`${earliest}T00:00:00Z`)
  const start = Number.isFinite(firstDay) && firstDay >= recentStart - DAY_MS
    ? Math.min(recentStart, firstDay)
    : recentStart
  const points: ChartPoint[] = []
  for (let time = start; time <= end; time += DAY_MS) {
    const day = new Date(time).toISOString().slice(0, 10)
    const row = rows.get(day)
    points.push({ day, input: count(row?.input_tokens ?? null), output: count(row?.output_tokens ?? null),
      reasoning: count(row?.reasoning_tokens ?? null) })
  }
  return points
}
