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
  | { kind: 'message'; role: 'user' | 'assistant'; text: string; startedAt?: number; duration?: number; estimated?: boolean; turnState?: 'completed' | 'failed' | 'interrupted' }
  | { kind: 'tools'; steps: ToolStep[] }
  | { kind: 'reasoning'; text: string; streaming: boolean; expanded: boolean }

type HistoryRow = ResumeResult['messages'][number]

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join('\n')
  if (!content || typeof content !== 'object') return ''
  const part = content as Record<string, unknown>
  if (['image', 'image_url', 'input_image', 'audio', 'input_audio'].includes(String(part.type || ''))) return ''
  for (const key of ['text', 'content', 'input_text', 'output_text', 'summary_text']) {
    if (typeof part[key] === 'string') return part[key]
  }
  return ''
}

function historyText(row: HistoryRow): string {
  return contentText(row.content) || row.text || ''
}

function reasoningText(row: HistoryRow): string {
  for (const value of [row.reasoning, row.reasoning_content]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  if (!Array.isArray(row.reasoning_details)) return ''
  return row.reasoning_details.flatMap(detail => {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return []
    const fields = detail as Record<string, unknown>
    const value = fields.summary || fields.thinking || fields.content || fields.text
    return typeof value === 'string' && value.trim() ? [value] : []
  }).join('\n\n')
}

function appendTool(items: TimelineItem[], step: ToolStep): TimelineItem[] {
  const last = items.at(-1)
  if (last?.kind === 'tools') return [...items.slice(0, -1), { kind: 'tools', steps: [...last.steps, step] }]
  return [...items, { kind: 'tools', steps: [step] }]
}

export function historyTimeline(rows: HistoryRow[], running = false): TimelineItem[] {
  let items: TimelineItem[] = []
  let pendingUserIndex = -1
  let pendingUserTimestamp: number | undefined
  for (const row of rows) {
    const text = historyText(row)
    if (row.role === 'tool') {
      items = appendTool(items, {
        id: row.tool_call_id || `history-${items.length}-${row.tool_name || row.name || 'tool'}`,
        name: row.tool_name || row.name || 'tool', context: row.context || undefined,
        args: row.args, state: 'recorded',
      })
    } else if (row.role === 'user' && text.trim()) {
      const timestamp = typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) && row.timestamp > 0
        ? row.timestamp : undefined
      pendingUserIndex = items.length
      pendingUserTimestamp = timestamp
      items = [...items, { kind: 'message', role: 'user', text, startedAt: timestamp == null ? undefined : timestamp * 1000, estimated: true }]
    } else if (row.role === 'assistant') {
      const thinking = reasoningText(row)
      if (!text.trim() && !thinking) continue
      const timestamp = typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) && row.timestamp > 0
        ? row.timestamp : undefined
      if (!running && text.trim() && pendingUserIndex !== -1 && pendingUserTimestamp != null && timestamp != null && timestamp >= pendingUserTimestamp) {
        const user = items[pendingUserIndex]
        if (user.kind === 'message' && user.role === 'user') {
          items[pendingUserIndex] = { ...user, duration: timestamp - pendingUserTimestamp, turnState: 'completed' }
        }
      }
      if (thinking) items = [...items, { kind: 'reasoning', text: thinking, streaming: false, expanded: false }]
      if (text.trim()) items = [...items, { kind: 'message', role: 'assistant', text }]
    }
  }
  return items
}

export function appendMessage(items: TimelineItem[], role: 'user' | 'assistant', text: string, startedAt?: number): TimelineItem[] {
  return text.trim() ? [...items, { kind: 'message', role, text, ...(startedAt == null ? {} : { startedAt }) }] : items
}

export function appendReasoning(items: TimelineItem[], text: string, available = false, expanded = true): TimelineItem[] {
  if (!text.trim()) return items
  const current = available ? pauseReasoning(items) : items
  const last = current.at(-1)
  if (available) {
    // reasoning.available is a bounded preview, not an end-of-reasoning event.
    const latest = [...current].reverse().find(item => item.kind === 'reasoning' || (item.kind === 'message' && item.role === 'user'))
    if (latest?.kind === 'reasoning' && latest.text.trim().startsWith(text.trim())) return current
  } else if (last?.kind === 'reasoning' && last.streaming && last.expanded === expanded) {
    return [...current.slice(0, -1), { ...last, text: last.text + text }]
  }
  return [...current, { kind: 'reasoning', text, streaming: !available, expanded }]
}

export function pauseReasoning(items: TimelineItem[]): TimelineItem[] {
  if (!items.some(item => item.kind === 'reasoning' && item.streaming)) return items
  return items.map(item => item.kind === 'reasoning' && item.streaming ? { ...item, streaming: false } : item)
}

export function finishReasoning(items: TimelineItem[]): TimelineItem[] {
  if (!items.some(item => item.kind === 'reasoning' && (item.streaming || item.expanded))) return items
  return items.map(item => item.kind === 'reasoning' && (item.streaming || item.expanded)
    ? { ...item, streaming: false, expanded: false } : item)
}

export function finishTurn(items: TimelineItem[], duration: number, turnState: 'completed' | 'failed' | 'interrupted'): TimelineItem[] {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.kind === 'message' && item.role === 'user' && item.startedAt != null && item.turnState == null) {
      return items.map((current, position) => position === index ? { ...item, duration, turnState } : current)
    }
  }
  return items
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
