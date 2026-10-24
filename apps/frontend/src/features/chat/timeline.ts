import type { ResumeResult } from '@hermess/contracts'

export type ToolStep = {
  id: string
  name: string
  context?: string
  args?: Record<string, unknown>
  summary?: string
  error?: string
  duration?: number
  state: 'running' | 'finished' | 'failed' | 'recorded'
}

export type TimelineItem =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string }
  | { kind: 'tools'; steps: ToolStep[] }

type HistoryRow = ResumeResult['messages'][number]

function appendTool(items: TimelineItem[], step: ToolStep): TimelineItem[] {
  const last = items.at(-1)
  if (last?.kind === 'tools') return [...items.slice(0, -1), { kind: 'tools', steps: [...last.steps, step] }]
  return [...items, { kind: 'tools', steps: [step] }]
}

export function historyTimeline(rows: HistoryRow[]): TimelineItem[] {
  let items: TimelineItem[] = []
  for (const row of rows) {
    if (row.role === 'tool') {
      items = appendTool(items, {
        id: row.tool_call_id || `history-${items.length}-${row.name || 'tool'}`,
        name: row.name || 'tool', context: row.context || undefined,
        args: row.args, state: 'recorded',
      })
    } else if ((row.role === 'user' || row.role === 'assistant') && row.text?.trim()) {
      items = [...items, { kind: 'message', role: row.role, text: row.text }]
    }
  }
  return items
}

export function appendMessage(items: TimelineItem[], role: 'user' | 'assistant', text: string): TimelineItem[] {
  return text.trim() ? [...items, { kind: 'message', role, text }] : items
}

function toolError(result: unknown, summary: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  const value = result as Record<string, unknown>
  const failed = Boolean(value.error) || value.success === false || value.status === 'error'
    || value.status === 'failed' || (typeof value.exit_code === 'number' && value.exit_code !== 0)
  if (!failed) return undefined
  if (typeof value.error === 'string' && value.error) return value.error
  if (typeof value.message === 'string' && value.message) return value.message
  if (typeof summary === 'string' && summary) return summary
  return typeof value.exit_code === 'number' ? `exit_code: ${value.exit_code}` : 'Tool failed'
}

export function updateTool(items: TimelineItem[], kind: 'tool.start' | 'tool.complete', payload: Record<string, unknown>): TimelineItem[] {
  const id = typeof payload.tool_id === 'string' ? payload.tool_id : ''
  const name = typeof payload.name === 'string' ? payload.name : 'tool'
  const args = payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
    ? payload.args as Record<string, unknown> : undefined
  const error = kind === 'tool.complete' ? toolError(payload.result, payload.summary) : undefined
  const step: ToolStep = {
    id: id || `${name}-${items.length}`, name,
    context: typeof payload.context === 'string' ? payload.context : undefined,
    args,
    summary: typeof payload.summary === 'string' ? payload.summary : undefined,
    error,
    duration: typeof payload.duration_s === 'number' ? payload.duration_s : undefined,
    state: kind === 'tool.start' ? 'running' : error ? 'failed' : 'finished',
  }
  if (id) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind !== 'tools') continue
      const at = item.steps.findIndex(existing => existing.id === id)
      if (at === -1) continue
      const steps = [...item.steps]
      steps[at] = { ...steps[at], ...step, context: step.context || steps[at].context, args: step.args || steps[at].args }
      return items.map((current, index) => index === i ? { kind: 'tools', steps } : current)
    }
  }
  return appendTool(items, step)
}
