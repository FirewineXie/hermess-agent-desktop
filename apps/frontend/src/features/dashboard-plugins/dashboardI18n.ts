import React from 'react'
import dashboardEn from './generated/dashboard.en.ts'
import dashboardZh from './generated/dashboard.zh.ts'
import dashboardZhHant from './generated/dashboard.zh-hant.ts'
import dashboardJa from './generated/dashboard.ja.ts'
import dashboardDe from './generated/dashboard.de.ts'
import dashboardEs from './generated/dashboard.es.ts'
import dashboardFr from './generated/dashboard.fr.ts'
import dashboardTr from './generated/dashboard.tr.ts'
import dashboardUk from './generated/dashboard.uk.ts'
import dashboardAf from './generated/dashboard.af.ts'
import dashboardKo from './generated/dashboard.ko.ts'
import dashboardIt from './generated/dashboard.it.ts'
import dashboardGa from './generated/dashboard.ga.ts'
import dashboardPt from './generated/dashboard.pt.ts'
import dashboardRu from './generated/dashboard.ru.ts'
import dashboardHu from './generated/dashboard.hu.ts'
import dashboardAr from './generated/dashboard.ar.ts'

export type DashboardLocale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'de' | 'es' | 'fr' | 'tr' | 'uk' | 'af' | 'ko' | 'it' | 'ga' | 'pt' | 'ru' | 'hu' | 'ar'
export type DashboardLanguage = 'en-US' | 'zh-CN'

const storageKey = 'hermes-locale'
const translations = {
  en: dashboardEn, zh: dashboardZh, 'zh-hant': dashboardZhHant, ja: dashboardJa, de: dashboardDe,
  es: dashboardEs, fr: dashboardFr, tr: dashboardTr, uk: dashboardUk, af: dashboardAf, ko: dashboardKo,
  it: dashboardIt, ga: dashboardGa, pt: dashboardPt, ru: dashboardRu, hu: dashboardHu, ar: dashboardAr,
} as const
const supportedLocales = new Set<DashboardLocale>(Object.keys(translations) as DashboardLocale[])
const listeners = new Set<() => void>()
const storedLocale = readStoredLocale()
let productLanguage: DashboardLanguage | null = null
let activeLocale: DashboardLocale = storedLocale || 'en'

function readStoredLocale(): DashboardLocale | null {
  try {
    const stored = localStorage.getItem(storageKey) as DashboardLocale | null
    if (stored && supportedLocales.has(stored)) return stored
  } catch { /* Node tests, SSR, or restricted storage. */ }
  return null
}

function updateLocale(locale: DashboardLocale, persist = true) {
  if (!supportedLocales.has(locale)) return
  activeLocale = locale
  if (persist) {
    try { localStorage.setItem(storageKey, locale) } catch { /* Restricted storage. */ }
  }
  for (const listener of listeners) listener()
}

export function syncDashboardPluginLanguage(language: DashboardLanguage) {
  if (productLanguage === null) {
    productLanguage = language
    if (!storedLocale) updateLocale(language === 'zh-CN' ? 'zh' : 'en', false)
    return
  }
  if (productLanguage === language) return
  productLanguage = language
  updateLocale(language === 'zh-CN' ? 'zh' : 'en', false)
}

export function dashboardPluginI18n(locale: DashboardLocale, setLocale: (locale: DashboardLocale) => void) {
  return {
    locale,
    setLocale,
    t: translations[locale],
  }
}

export function useDashboardPluginI18n(onProductLanguage: (language: DashboardLanguage) => void) {
  const locale = React.useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener) },
    () => activeLocale,
    () => activeLocale,
  )
  return dashboardPluginI18n(locale, next => {
    updateLocale(next)
    if (next === 'zh' || next === 'en') onProductLanguage(next === 'zh' ? 'zh-CN' : 'en-US')
  })
}
