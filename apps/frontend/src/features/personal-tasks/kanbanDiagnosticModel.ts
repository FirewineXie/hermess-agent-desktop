import type { KanbanDiagnosticAction } from './kanbanApi'

export type DiagnosticMutation = { method: 'POST' | 'PATCH'; path: string; body: Record<string, unknown> }

export function diagnosticMutation(taskId: string, diagnosticKind: string, action: KanbanDiagnosticAction, profile: string): DiagnosticMutation | null {
  const id = encodeURIComponent(taskId)
  const reason = `recovery action for ${diagnosticKind}`
  if (action.kind === 'reclaim') return { method: 'POST', path: `/tasks/${id}/reclaim`, body: { reason } }
  if (action.kind === 'unblock') return { method: 'PATCH', path: `/tasks/${id}`, body: { status: 'ready' } }
  if (action.kind === 'reassign' && profile) return {
    method: 'POST', path: `/tasks/${id}/reassign`, body: {
      profile, reclaim_first: action.payload?.reclaim_first === true, reason,
    },
  }
  return null
}

export function diagnosticDocsUrl(action: KanbanDiagnosticAction): string | null {
  if (action.kind !== 'open_docs' || typeof action.payload?.url !== 'string') return null
  try {
    const url = new URL(action.payload.url)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch { return null }
}
