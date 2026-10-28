import type { DelegationRouting } from '@hermess/contracts'

type ModelRoute = DelegationRouting['model_map']['options'][number]
export type RouteFallback = Record<string, unknown> & { provider: string; model: string }

export function routeFallbacks(value: unknown): RouteFallback[] {
  if (!Array.isArray(value)) return []
  return value.map(entry => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const row = entry as Record<string, unknown>
      return { ...row, provider: String(row.provider || ''), model: String(row.model || '') }
    }
    if (typeof entry === 'string') {
      const slash = entry.indexOf('/')
      return slash > 0 ? { provider: entry.slice(0, slash), model: entry.slice(slash + 1) } : { provider: '', model: entry }
    }
    return { provider: '', model: '' }
  })
}

export function parseRouteOverrides(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch { return null }
}

export function updateModelRoute(routing: DelegationRouting, index: number, changes: Partial<ModelRoute>): DelegationRouting {
  const previous = routing.model_map.options[index]
  if (!previous) return routing
  const next = { ...previous, ...changes }
  if (changes.name !== undefined && changes.name !== previous.name && previous.name) {
    next.original_name = previous.original_name || previous.name
  }
  return {
    ...routing,
    model_map: {
      ...routing.model_map,
      default: routing.model_map.default === previous.name && changes.name !== undefined ? changes.name || null : routing.model_map.default,
      options: routing.model_map.options.map((row, rowIndex) => rowIndex === index ? next : row),
    },
  }
}
