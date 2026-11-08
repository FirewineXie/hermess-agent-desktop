import { appendMessage, finishReasoning, type TimelineItem } from './timeline.ts'

/** Canonical Gateway closes streamed segments with null and publishes unstreamed interims separately. */
export function consumeAssistantSegment(
  event: { kind: string; payload?: Record<string, unknown> },
  current: { current: string },
  setAssistant: (value: string) => void,
  setConversation: (update: (rows: TimelineItem[]) => TimelineItem[]) => void,
): boolean {
  const boundary = event.kind === 'message.delta' && event.payload?.text === null
  const interim = event.kind === 'message.interim'
  if (!boundary && !interim) return false
  const text = interim && typeof event.payload?.text === 'string' ? event.payload.text : current.current
  if (text.trim()) setConversation(rows => appendMessage(finishReasoning(rows), 'assistant', text))
  current.current = ''
  setAssistant('')
  return true
}

export function appendCompletedAssistant(rows: TimelineItem[], text: string, payload?: Record<string, unknown>): TimelineItem[] {
  const last = rows.at(-1)
  // A segment boundary can precede a complete event containing the same final text.
  if (last?.kind === 'message' && last.role === 'assistant' && last.text === text) return rows
  // Canonical Gateway explicitly marks a reply reused after housekeeping tools.
  // Match within this turn only; equal text from an earlier user turn is unrelated.
  if (payload?.response_reused === true || payload?.response_previewed === true) {
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index]
      if (row.kind !== 'message') continue
      if (row.role === 'user') break
      if (row.text === text) return rows
    }
  }
  return appendMessage(rows, 'assistant', text)
}
