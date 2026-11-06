import type { KanbanDetail } from './kanbanApi'

type ReviewEvent = KanbanDetail['events'][number]

export type KanbanReviewFlow = {
  returnedForChanges: boolean
  returnKind: 'changes_requested' | 'review_reopened' | null
  reviewer: string | null
  implementer: string | null
  reason: string | null
}

function eventPayload(event: ReviewEvent): Record<string, unknown> {
  const payload = event.payload
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload as Record<string, unknown>
  if (typeof payload !== 'string' || !payload.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(payload)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function inspectKanbanReviewFlow(events: ReviewEvent[]): KanbanReviewFlow {
  let requestedId = -1
  let returnedId = -1
  let returnKind: KanbanReviewFlow['returnKind'] = null
  let reviewer: string | null = null
  let implementer: string | null = null
  let reason: string | null = null

  for (const event of events) {
    const payload = eventPayload(event)
    if (event.kind === 'review_requested' && event.id >= requestedId) {
      requestedId = event.id
      reviewer = text(payload.reviewer) || reviewer
      implementer = text(payload.implementer) || implementer
    }
    if ((event.kind === 'changes_requested' || event.kind === 'review_reopened') && event.id >= returnedId) {
      returnedId = event.id
      returnKind = event.kind
      reviewer = text(payload.reviewer) || reviewer
      implementer = text(payload.implementer) || implementer
      reason = text(payload.reason)
    }
  }

  return {
    returnedForChanges: returnedId > requestedId,
    returnKind,
    reviewer,
    implementer,
    reason,
  }
}
