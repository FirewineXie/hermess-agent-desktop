import React from 'react'
import appZh from './locales/app/ui.zh-CN.json'
import appEn from './locales/app/ui.en-US.json'
import agentZh from './locales/hermes-agent/ui.zh-CN.json'
import agentEn from './locales/hermes-agent/ui.en-US.json'
import fieldsZh from './locales/hermes-agent/fields.zh-CN.json'
import fieldsEn from './locales/hermes-agent/fields.en-US.json'
import optionsZh from './locales/hermes-agent/options.zh-CN.json'
import optionsEn from './locales/hermes-agent/options.en-US.json'
import categoriesZh from './locales/hermes-agent/categories.zh-CN.json'
import categoriesEn from './locales/hermes-agent/categories.en-US.json'

export type Language = 'zh-CN' | 'en-US'
const STORAGE_KEY = 'hermess-desktop-language'
const LanguageContext = React.createContext<Language>('zh-CN')

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = React.useState<Language>(() =>
    localStorage.getItem(STORAGE_KEY) === 'en-US' ? 'en-US' : 'zh-CN')
  React.useEffect(() => {
    const update = (event: Event) => setLanguage((event as CustomEvent<Language>).detail)
    window.addEventListener('hermess-language-change', update)
    return () => window.removeEventListener('hermess-language-change', update)
  }, [])
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>
}

export function useLanguage(): Language { return React.useContext(LanguageContext) }
export function changeLanguage(language: Language) {
  window.dispatchEvent(new CustomEvent('hermess-language-change', { detail: language }))
}

function format(table: Record<string, string>, key: string, values: unknown[]): string {
  const template = (table as Record<string, string>)[key] || key
  return template.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''))
}

export function translateApp(language: Language, key: string, ...values: unknown[]): string {
  return format(language === 'zh-CN' ? appZh : appEn, key, values)
}

export function translateAgentUi(language: Language, key: string, ...values: unknown[]): string {
  return format(language === 'zh-CN' ? agentZh : agentEn, key, values)
}

type FieldTranslation = { label: string; description?: string }
export function agentFieldTranslation(language: Language, key: string): FieldTranslation | undefined {
  const table = language === 'zh-CN' ? fieldsZh : fieldsEn
  return (table as Record<string, FieldTranslation>)[key]
}

export function agentOptionTranslation(language: Language, value: string): string {
  const table = language === 'zh-CN' ? optionsZh : optionsEn
  return (table as Record<string, string>)[value] || value || translateAgentUi(language, 'ui.default')
}

export function agentCategoryTranslation(language: Language, category: string): string {
  const table = language === 'zh-CN' ? categoriesZh : categoriesEn
  return (table as Record<string, string>)[category] || category
}

function messagePattern(template: string): RegExp {
  const escaped = template.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${escaped.join('([\\s\\S]*?)')}$`)
}

function localizeMessage(language: Language, message: string, zh: Record<string, string>, en: Record<string, string>): string {
  if (!message) return message
  for (const key of Object.keys(zh)) {
    if (message === zh[key] || message === en[key]) return language === 'zh-CN' ? zh[key] : en[key]
  }
  const templates = Object.keys(zh).filter(key => zh[key].includes('{0}'))
    .sort((a, b) => zh[b].length - zh[a].length)
  for (const key of templates) {
    for (const source of [zh[key], en[key]]) {
      const match = message.match(messagePattern(source))
      if (match) return format(language === 'zh-CN' ? zh : en, key, match.slice(1))
    }
  }
  return message
}

export function localizeAppMessage(language: Language, message: string): string {
  return localizeMessage(language, message, appZh, appEn)
}

export function localizeAgentMessage(language: Language, message: string): string {
  return localizeMessage(language, message, agentZh, agentEn)
}
