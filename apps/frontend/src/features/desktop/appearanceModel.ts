export type AppearanceTheme = 'system' | 'light' | 'dark'
export type AppearanceFont = 'system-sans' | 'system-serif' | 'system-mono'

export type AppearancePreference = { theme: AppearanceTheme; font: AppearanceFont }

export const DEFAULT_APPEARANCE: AppearancePreference = { theme: 'system', font: 'system-sans' }

const themes = new Set<AppearanceTheme>(['system', 'light', 'dark'])
const fonts = new Set<AppearanceFont>(['system-sans', 'system-serif', 'system-mono'])

export function parseAppearance(raw: string | null): AppearancePreference {
  if (!raw) return DEFAULT_APPEARANCE
  try {
    const value = JSON.parse(raw) as Partial<AppearancePreference>
    return {
      theme: typeof value.theme === 'string' && themes.has(value.theme as AppearanceTheme) ? value.theme as AppearanceTheme : DEFAULT_APPEARANCE.theme,
      font: typeof value.font === 'string' && fonts.has(value.font as AppearanceFont) ? value.font as AppearanceFont : DEFAULT_APPEARANCE.font,
    }
  } catch { return DEFAULT_APPEARANCE }
}

export function resolvedTheme(preference: AppearancePreference, systemDark: boolean): 'light' | 'dark' {
  return preference.theme === 'system' ? (systemDark ? 'dark' : 'light') : preference.theme
}
