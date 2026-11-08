import React from 'react'
import type { ModelProvider } from '@hermess/contracts'
import { VOLCENGINE_PRESETS } from '../model'

export default function ProviderPresetOptions({ providers, language, t }: {
  providers: ModelProvider[]; language: 'zh-CN' | 'en-US'; t: (key: string, ...values: unknown[]) => string
}) {
  return <optgroup label={language === 'zh-CN' ? 'API 密钥与自定义端点' : 'API keys and custom endpoints'}>
    <option value="">{t('ui.custom.provider.template')}</option>
    {VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{t(preset.name)}</option>)}
    {providers.filter(item => item.slug !== 'custom' && !item.slug.startsWith('custom:') && !item.is_user_defined).map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
  </optgroup>
}
