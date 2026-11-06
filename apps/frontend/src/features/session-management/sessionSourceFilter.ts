export const AUTOMATION_SESSION_SOURCES = [
  'cron',
  'tool',
  'oneshot',
  'api_server',
  'acp',
  'hermes_flow',
  'vulcan_delegate',
  'webhook',
] as const

export type SessionCategory = 'all' | 'chats' | 'automation'
export type SourceSelections = Record<SessionCategory, string[] | null>
export type SessionSourceFilter = {
  source?: string
  sources?: string[]
  excludeSources?: string[]
}

const automationSources = new Set<string>(AUTOMATION_SESSION_SOURCES)

export function sourceBelongsToCategory(source: string, category: SessionCategory) {
  if (category === 'all') return true
  return category === 'automation' ? automationSources.has(source) : !automationSources.has(source)
}

export function sourcesForCategory(sources: string[], category: SessionCategory) {
  return sources.filter(source => sourceBelongsToCategory(source, category))
}

export function buildSessionSourceFilter(
  category: SessionCategory,
  selectedSources: string[] | null,
  allSources: string[],
): SessionSourceFilter {
  if (selectedSources !== null) {
    if (selectedSources.length === 0) {
      return allSources.length > 0
        ? { excludeSources: allSources }
        : { source: '__hermes_dashboard_no_matching_source__' }
    }
    if (selectedSources.length === 1) return { source: selectedSources[0] }
    const selected = new Set(selectedSources)
    const excludedSources = allSources.filter(source => !selected.has(source))
    return excludedSources.length > 0 ? { excludeSources: excludedSources } : {}
  }
  if (category === 'chats') return { excludeSources: [...AUTOMATION_SESSION_SOURCES] }
  if (category === 'automation') {
    const excludedSources = allSources.filter(source => !automationSources.has(source))
    return excludedSources.length > 0
      ? { excludeSources: excludedSources }
      : { sources: [...AUTOMATION_SESSION_SOURCES] }
  }
  return {}
}
