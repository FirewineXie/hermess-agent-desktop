import type { AgentConfigField, AgentConfigSchema } from '@hermess/contracts'

export type MemorySettingsPage = 'memory-persistent' | 'memory-context'
export type MemoryFieldEntry = [string, AgentConfigField]

export type MemoryFieldGroup = {
  id: 'persistent' | 'context' | 'compression' | 'compression-model'
  zh: string
  en: string
  descriptionZh: string
  descriptionEn: string
  fields: MemoryFieldEntry[]
}

const SENSITIVE_FIELD = /(?:^|\.)(?:api_key|token|secret|password)$/i
const SUPPORTED_FIELD_TYPES = new Set(['boolean', 'list', 'number', 'object', 'select', 'string', 'text'])
const PERSISTENT_PRIORITY = [
  'memory.memory_enabled',
  'memory.user_profile_enabled',
  'memory.memory_char_limit',
  'memory.user_char_limit',
  'memory.provider',
]

export function isMemoryContextField(key: string): boolean {
  return key.startsWith('memory.')
    || key.startsWith('context.')
    || key.startsWith('compression.')
    || key.startsWith('auxiliary.compression.')
}

export function isSensitiveConfigField(key: string): boolean {
  return SENSITIVE_FIELD.test(key)
}

export function isSupportedConfigField(field: AgentConfigField): boolean {
  return SUPPORTED_FIELD_TYPES.has(field.type)
}

function persistentOrder([key]: MemoryFieldEntry): number {
  const priority = PERSISTENT_PRIORITY.indexOf(key)
  return priority < 0 ? PERSISTENT_PRIORITY.length : priority
}

export function memoryFieldGroups(schema: AgentConfigSchema | null, page: MemorySettingsPage): MemoryFieldGroup[] {
  const entries = Object.entries(schema?.fields || {}).filter(([key, field]) => isMemoryContextField(key) && !isSensitiveConfigField(key) && isSupportedConfigField(field))
  if (page === 'memory-persistent') {
    return [{
      id: 'persistent',
      zh: '持久记忆',
      en: 'Persistent memory',
      descriptionZh: '控制当前 Profile 的长期记忆、用户画像和记忆提供方。',
      descriptionEn: 'Controls long-term memory, the user profile, and the memory provider for this Profile.',
      fields: entries.filter(([key]) => key.startsWith('memory.')).sort((left, right) => persistentOrder(left) - persistentOrder(right)),
    }]
  }
  return [
    {
      id: 'context',
      zh: '上下文引擎',
      en: 'Context engine',
      descriptionZh: '选择并配置当前 Profile 使用的上下文管理方式。',
      descriptionEn: 'Selects and configures context management for this Profile.',
      fields: entries.filter(([key]) => key.startsWith('context.')),
    },
    {
      id: 'compression',
      zh: '压缩策略',
      en: 'Compression policy',
      descriptionZh: '控制何时压缩、压缩目标以及需要保留的最近消息。',
      descriptionEn: 'Controls when compression runs, its target, and the recent messages it preserves.',
      fields: entries.filter(([key]) => key.startsWith('compression.')),
    },
    {
      id: 'compression-model',
      zh: '压缩模型',
      en: 'Compression model',
      descriptionZh: '配置生成压缩摘要时使用的辅助模型参数。',
      descriptionEn: 'Configures the auxiliary model used to produce compression summaries.',
      fields: entries.filter(([key]) => key.startsWith('auxiliary.compression.')),
    },
  ]
}

export function sensitiveMemoryFieldCount(schema: AgentConfigSchema | null, page: MemorySettingsPage): number {
  return Object.keys(schema?.fields || {}).filter(key => {
    const inPage = page === 'memory-persistent' ? key.startsWith('memory.') : key.startsWith('context.') || key.startsWith('compression.') || key.startsWith('auxiliary.compression.')
    return inPage && isSensitiveConfigField(key)
  }).length
}

export function unsupportedMemoryFieldCount(schema: AgentConfigSchema | null, page: MemorySettingsPage): number {
  return Object.entries(schema?.fields || {}).filter(([key, field]) => {
    const inPage = page === 'memory-persistent' ? key.startsWith('memory.') : key.startsWith('context.') || key.startsWith('compression.') || key.startsWith('auxiliary.compression.')
    return inPage && !isSensitiveConfigField(key) && !isSupportedConfigField(field)
  }).length
}

export function getNestedConfigValue(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined, config)
}

export function configFieldText(value: unknown, type: string): string {
  if (value == null) return ''
  if (type === 'list' || type === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

export function parseConfigFieldDraft(text: string, field: AgentConfigField): unknown {
  if (field.type === 'number') {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('invalid-number')
    return Number(text)
  }
  if (field.type === 'boolean') return text === 'true'
  if (field.type === 'list' || field.type === 'object') {
    let value: unknown
    try { value = JSON.parse(text) }
    catch { throw new Error(field.type === 'list' ? 'invalid-array' : 'invalid-object') }
    if (field.type === 'list' ? !Array.isArray(value) : value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(field.type === 'list' ? 'invalid-array' : 'invalid-object')
    }
    return value
  }
  return text
}

export function configValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => configValuesEqual(item, right[index]))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord).sort()
    const rightKeys = Object.keys(rightRecord).sort()
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && configValuesEqual(leftRecord[key], rightRecord[key]))
  }
  return false
}
