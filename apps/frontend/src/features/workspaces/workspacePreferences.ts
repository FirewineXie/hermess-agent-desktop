import { displayPath } from '../../shared/displayPath.ts'

export type WorkspacePreferences = {
  paths: string[]
  selectedByProfile: Record<string, string>
  legacySelected?: string
}

type LegacyWorkspaces = { paths?: unknown; selected?: unknown }

function normalizedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((path): path is string => typeof path === 'string' && Boolean(path.trim()))
    .map(displayPath)
    .filter((path, index, paths) => paths.findIndex(candidate => samePath(candidate, path)) === index)
}

function validSelection(paths: string[], value: unknown): string {
  if (typeof value !== 'string') return ''
  const selected = displayPath(value)
  return paths.find(path => samePath(path, selected)) || ''
}

export function samePath(left: string, right: string): boolean {
  return left.replaceAll('/', '\\').replace(/[\\]+$/, '').toLocaleLowerCase() === right.replaceAll('/', '\\').replace(/[\\]+$/, '').toLocaleLowerCase()
}

export function readWorkspacePreferences(currentValue: string | null, legacyValue: string | null): WorkspacePreferences {
  try {
    if (currentValue) {
      const value = JSON.parse(currentValue) as Partial<WorkspacePreferences>
      const paths = normalizedPaths(value.paths)
      const selectedByProfile = Object.fromEntries(Object.entries(value.selectedByProfile || {})
        .map(([profile, selected]) => [profile, validSelection(paths, selected)])
        .filter(([profile]) => Boolean(profile)))
      const legacySelected = validSelection(paths, value.legacySelected)
      return { paths, selectedByProfile, ...(legacySelected ? { legacySelected } : {}) }
    }

    const legacy = JSON.parse(legacyValue || '{}') as LegacyWorkspaces
    const paths = normalizedPaths(legacy.paths)
    const legacySelected = validSelection(paths, legacy.selected)
    return { paths, selectedByProfile: {}, ...(legacySelected ? { legacySelected } : {}) }
  } catch {
    return { paths: [], selectedByProfile: {} }
  }
}

export function migrateLegacySelection(preferences: WorkspacePreferences, profile: string | null): WorkspacePreferences {
  if (!profile || !preferences.legacySelected) return preferences
  return {
    paths: preferences.paths,
    selectedByProfile: Object.hasOwn(preferences.selectedByProfile, profile)
      ? preferences.selectedByProfile
      : { ...preferences.selectedByProfile, [profile]: preferences.legacySelected },
  }
}

export function selectedWorkspace(preferences: WorkspacePreferences, profile: string | null): string {
  if (!profile) return ''
  return Object.hasOwn(preferences.selectedByProfile, profile)
    ? preferences.selectedByProfile[profile]
    : preferences.legacySelected || ''
}

export function addWorkspace(preferences: WorkspacePreferences, profile: string | null, path: string): WorkspacePreferences {
  path = displayPath(path)
  const existing = preferences.paths.find(item => samePath(item, path))
  const selected = existing || path
  return {
    ...preferences,
    paths: existing ? preferences.paths : [...preferences.paths, path],
    selectedByProfile: profile ? { ...preferences.selectedByProfile, [profile]: selected } : preferences.selectedByProfile,
  }
}

export function selectWorkspace(preferences: WorkspacePreferences, profile: string | null, path: string): WorkspacePreferences {
  if (!profile) return preferences
  path = displayPath(path)
  if (path && !preferences.paths.some(item => samePath(item, path))) return preferences
  return { ...preferences, selectedByProfile: { ...preferences.selectedByProfile, [profile]: path } }
}

export function removeWorkspace(preferences: WorkspacePreferences, path: string): WorkspacePreferences {
  path = displayPath(path)
  const selectedByProfile = Object.fromEntries(Object.entries(preferences.selectedByProfile)
    .map(([profile, selected]) => [profile, samePath(selected, path) ? '' : selected]))
  return {
    paths: preferences.paths.filter(item => !samePath(item, path)),
    selectedByProfile,
    ...(preferences.legacySelected && !samePath(preferences.legacySelected, path) ? { legacySelected: preferences.legacySelected } : {}),
  }
}

export function renameWorkspaceProfile(preferences: WorkspacePreferences, previousProfile: string, nextProfile: string): WorkspacePreferences {
  if (!Object.hasOwn(preferences.selectedByProfile, previousProfile) || previousProfile === nextProfile) return preferences
  const selectedByProfile = { ...preferences.selectedByProfile }
  const selected = selectedByProfile[previousProfile]
  delete selectedByProfile[previousProfile]
  selectedByProfile[nextProfile] = selected
  return { ...preferences, selectedByProfile }
}

export function removeWorkspaceProfile(preferences: WorkspacePreferences, profile: string): WorkspacePreferences {
  if (!Object.hasOwn(preferences.selectedByProfile, profile)) return preferences
  const selectedByProfile = { ...preferences.selectedByProfile }
  delete selectedByProfile[profile]
  return { ...preferences, selectedByProfile }
}
