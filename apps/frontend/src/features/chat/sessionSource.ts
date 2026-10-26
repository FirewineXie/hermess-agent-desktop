import type { SessionRow } from '@hermess/contracts'

export function sessionSourceLabel(source: SessionRow['source'], language: 'zh-CN' | 'en-US'): string {
  if (!source || ['local', 'desktop', 'cli', 'tui', 'gui'].includes(source)) return ''
  if (source === 'weixin') return language === 'zh-CN' ? '微信' : 'WeChat'
  if (source === 'feishu') return language === 'zh-CN' ? '飞书' : 'Feishu'
  return source
}
