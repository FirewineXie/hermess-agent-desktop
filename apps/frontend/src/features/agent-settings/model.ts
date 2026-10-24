import { agentFieldTranslation, agentCategoryTranslation, type Language } from '../../i18n'

export type Field = { type: string; description?: string; category?: string; options?: unknown[] }
export type Schema = { fields: Record<string, Field>; category_order: string[] }
export type RawConfig = { yaml: string; path: string }
export type Provider = { slug: string; name: string; models: string[]; authenticated?: boolean; api_url?: string }
export type Endpoint = { id: string; name: string; base_url: string; models: string[]; model: string; source: string }
export type FieldEntry = [string, Field]
export type FieldNode = { path: string; children: Map<string, FieldNode>; field?: FieldEntry }

export function fieldTree(entries: FieldEntry[]): FieldNode {
  const root: FieldNode = { path: '', children: new Map() }
  for (const entry of entries) {
    let node = root
    for (const part of entry[0].split('.')) {
      if (!node.children.has(part)) node.children.set(part, { path: node.path ? `${node.path}.${part}` : part, children: new Map() })
      node = node.children.get(part)!
    }
    node.field = entry
  }
  return root
}

export function leafLabel(language: Language, key: string): string {
  return agentFieldTranslation(language, key)?.label.split(/\s*\/\s*/).at(-1) || key.split('.').at(-1) || key
}

export function nodeLabel(language: Language, node: FieldNode, entries: FieldEntry[]): string {
  const parts = node.path.split('.')
  const segment = parts[parts.length - 1]
  if (parts.length === 1) {
    const category = agentCategoryTranslation(language, segment)
    if (category !== segment) return category
  }
  const candidates = entries.filter(([key]) => key.startsWith(`${node.path}.`))
    .map(([key]) => {
      const labels = agentFieldTranslation(language, key)?.label.split(/\s*\/\s*/)
      return labels?.length === key.split('.').length ? labels[parts.length - 1] : undefined
    }).filter((label): label is string => Boolean(label))
  return candidates.sort((a, b) => a.length - b.length)[0] || segment.replaceAll('_', ' ')
}

export function getField(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key] : undefined, config)
}

export function fieldText(value: unknown, type: string): string {
  if (value == null) return ''
  if (type === 'list' || type === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

