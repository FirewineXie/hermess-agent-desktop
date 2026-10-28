export type SettingsPage = 'providers' | 'main' | 'fallbacks' | 'auxiliary' | 'runtime' | 'about'

export const settingsPages: Array<{ id: SettingsPage; category: 'models' | 'runtime' | 'about'; zh: string; en: string }> = [
  { id: 'providers', category: 'models', zh: '提供商', en: 'Providers' },
  { id: 'main', category: 'models', zh: '主模型', en: 'Main model' },
  { id: 'fallbacks', category: 'models', zh: '回退模型', en: 'Fallback models' },
  { id: 'auxiliary', category: 'models', zh: '辅助模型', en: 'Auxiliary models' },
  { id: 'runtime', category: 'runtime', zh: '运行时与存储', en: 'Runtime & storage' },
  { id: 'about', category: 'about', zh: '关于', en: 'About' },
]
