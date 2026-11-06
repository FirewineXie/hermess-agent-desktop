import { DEFAULT_APPEARANCE, parseAppearance, resolvedTheme, type AppearancePreference } from './appearanceModel'

const STORAGE_KEY = 'hermess.desktop.appearance.v1'
const CHANGE_EVENT = 'hermess-appearance-change'
let initialized = false

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

export function readAppearance(): AppearancePreference {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE
  return parseAppearance(window.localStorage.getItem(STORAGE_KEY))
}

export function applyAppearance(preference = readAppearance()): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.colorTheme = resolvedTheme(preference, systemDark())
  root.dataset.themePreference = preference.theme
  root.dataset.font = preference.font
}

export function saveAppearance(preference: AppearancePreference): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference))
  applyAppearance(preference)
  window.dispatchEvent(new CustomEvent<AppearancePreference>(CHANGE_EVENT, { detail: preference }))
  console.info('[appearance] preference saved', { theme: preference.theme, font: preference.font })
}

export function subscribeAppearance(handler: (preference: AppearancePreference) => void): () => void {
  const changed = (event: Event) => handler((event as CustomEvent<AppearancePreference>).detail || readAppearance())
  const stored = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) { applyAppearance(); handler(readAppearance()) }
  }
  window.addEventListener(CHANGE_EVENT, changed)
  window.addEventListener('storage', stored)
  return () => { window.removeEventListener(CHANGE_EVENT, changed); window.removeEventListener('storage', stored) }
}

export function initializeAppearance(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  applyAppearance()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readAppearance().theme === 'system') applyAppearance()
  })
}
