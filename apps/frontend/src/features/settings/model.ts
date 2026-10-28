export type SettingsCategory = 'models' | 'memory' | 'runtime' | 'about'
export type SettingsPage = 'providers' | 'main' | 'fallbacks' | 'auxiliary' | 'memory-persistent' | 'memory-context' | 'runtime' | 'about'

export const settingsPages: Array<{ id: SettingsPage; category: SettingsCategory; zh: string; en: string }> = [
  { id: 'providers', category: 'models', zh: '提供商', en: 'Providers' },
  { id: 'main', category: 'models', zh: '主模型', en: 'Main model' },
  { id: 'fallbacks', category: 'models', zh: '回退模型', en: 'Fallback models' },
  { id: 'auxiliary', category: 'models', zh: '辅助模型', en: 'Auxiliary models' },
  { id: 'memory-persistent', category: 'memory', zh: '持久记忆', en: 'Persistent memory' },
  { id: 'memory-context', category: 'memory', zh: '上下文与压缩', en: 'Context & compression' },
  { id: 'runtime', category: 'runtime', zh: '运行时与存储', en: 'Runtime & storage' },
  { id: 'about', category: 'about', zh: '关于', en: 'About' },
]

export const settingsCategories: Array<{
  id: SettingsCategory
  page: SettingsPage
  zh: string
  en: string
  descriptionZh: string
  descriptionEn: string
  profileScoped: boolean
}> = [
  { id: 'models', page: 'providers', zh: '模型', en: 'Models', descriptionZh: '当前 Profile 的提供商与模型配置', descriptionEn: 'Providers and models for the selected Profile', profileScoped: true },
  { id: 'memory', page: 'memory-persistent', zh: '记忆与上下文', en: 'Memory & context', descriptionZh: '当前 Profile 的持久记忆、上下文和压缩配置', descriptionEn: 'Memory, context, and compression for the selected Profile', profileScoped: true },
  { id: 'runtime', page: 'runtime', zh: '运行时与存储', en: 'Runtime & storage', descriptionZh: '', descriptionEn: '', profileScoped: false },
  { id: 'about', page: 'about', zh: '关于', en: 'About', descriptionZh: '', descriptionEn: '', profileScoped: false },
]
