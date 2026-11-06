type ScheduledHealthJob = {
  next_run_at?: string | null
  enabled?: boolean
  state?: string
  scheduler_heartbeat_age_s?: number | null
}

export const nextRunOverdueGraceMs = 15 * 60 * 1000
export const schedulerStaleAfterSeconds = 60 * 3 + 20

export function scheduledJobState(job: Pick<ScheduledHealthJob, 'state' | 'enabled'>): string {
  const state = typeof job.state === 'string' ? job.state.trim() : ''
  return state || (job.enabled === false ? 'disabled' : 'scheduled')
}

export function scheduledJobStateLabel(state: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    scheduled: ['已计划', 'Scheduled'],
    paused: ['已暂停', 'Paused'],
    error: ['调度错误', 'Error'],
    completed: ['已完成', 'Completed'],
    disabled: ['已停用', 'Disabled'],
  }
  return labels[state]?.[zh ? 0 : 1] || state
}

export function scheduledJobStateCounts(jobs: Pick<ScheduledHealthJob, 'state' | 'enabled'>[]): Record<string, number> {
  return jobs.reduce<Record<string, number>>((counts, job) => {
    const state = scheduledJobState(job)
    counts[state] = (counts[state] || 0) + 1
    return counts
  }, {})
}

export function nextRunOverdueMs(job: ScheduledHealthJob, nowMs = Date.now()): number | null {
  if (job.enabled === false || job.state === 'paused' || job.state === 'completed') return null
  const scheduled = Date.parse(typeof job.next_run_at === 'string' ? job.next_run_at : '')
  if (Number.isNaN(scheduled)) return null
  const overdue = nowMs - scheduled
  return overdue > nextRunOverdueGraceMs ? overdue : null
}

export function schedulerStaleAge(jobs: ScheduledHealthJob[]): number | null {
  let stale: number | null = null
  for (const job of jobs) {
    const age = job.scheduler_heartbeat_age_s
    if (typeof age !== 'number' || age <= schedulerStaleAfterSeconds) continue
    if (job.enabled === false || job.state === 'paused' || job.state === 'completed') continue
    if (stale === null || age > stale) stale = age
  }
  return stale
}

export function elapsedLabel(seconds: number, zh: boolean): string {
  if (seconds < 3600) return zh ? `${Math.max(1, Math.floor(seconds / 60))} 分钟前` : `${Math.max(1, Math.floor(seconds / 60))}m ago`
  if (seconds < 86400) return zh ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 3600)}h ago`
  return zh ? `${Math.floor(seconds / 86400)} 天前` : `${Math.floor(seconds / 86400)}d ago`
}

export function repeatLabel(repeat: { times: number | null; completed?: number | null } | null | undefined, zh: boolean): string {
  if (!repeat || repeat.times == null) return zh ? '无限次' : 'forever'
  const completed = repeat.completed ?? 0
  if (completed > 0) return `${completed}/${repeat.times}`
  return zh ? `${repeat.times} 次` : `${repeat.times} times`
}
