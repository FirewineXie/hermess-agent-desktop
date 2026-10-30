import type { DelegationRouting } from '@hermess/contracts'

export function delegationError(value: DelegationRouting): string | null {
  const backend = value.backends.find(item => item.name === value.configured)
  if (!backend?.available) return backend?.reason || '当前运行时未提供此委派策略。'
  const rows = value.configured === 'model_map' ? value.model_map.options : value.configured === 'profile_routes' ? value.profile_routes.profiles : []
  const names = rows.map(row => row.name.trim())
  if (names.some(name => !name) || new Set(names).size !== names.length) return '路由名称不能为空或重复。'
  const selected = value.configured === 'model_map' ? value.model_map.default : value.configured === 'profile_routes' ? value.profile_routes.default : null
  if (selected && !names.includes(selected)) return '默认路由必须存在于列表中。'
  if (value.configured === 'profile_routes' && names.some(name => !value.profiles.includes(name))) return '目标 Profile 已不存在，请重新选择。'
  if (value.configured === 'model_map') for (const row of value.model_map.options) {
    if (!row.description.trim() || !row.model.trim() || !(row.provider?.trim() || row.base_url?.trim())) return '每条路由必须填写任务描述、模型，以及提供商或地址。'
    if (row.base_url) {
      try { const url = new URL(row.base_url); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) return '接口地址必须是有效的 HTTP(S) 地址。' }
      catch { return '接口地址无效。' }
    }
    if (row.fallback_providers?.some(item => !item.provider.trim() || !item.model.trim())) return '回退模型必须填写提供商和模型。'
    if (row.credential?.action === 'replace' && !row.credential.value?.trim()) return '替换密钥时必须填写新密钥。'
  }
  return null
}

export function parseOverrides(text: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).length > 16384) throw new Error('请求覆盖参数不能超过 16 KiB。')
  const value: unknown = JSON.parse(text || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求覆盖参数必须是 JSON 对象。')
  return value as Record<string, unknown>
}

export function routesMatch(expected: DelegationRouting, actual: DelegationRouting): boolean {
  if (expected.configured !== actual.configured) return false
  if (expected.configured === 'default') return true
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, stable(v)]))
    return value
  }
  const cleanRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key, value]) => {
    if (['credential', 'original_name', 'has_api_key'].includes(key)) return false
    if (key === 'request_overrides') return value !== undefined && value !== null && Object.keys(value as object).length > 0
    return value !== '' && value !== null && value !== undefined && !(Array.isArray(value) && !value.length)
  }))
  const key = expected.configured === 'model_map' ? 'model_map' : 'profile_routes'
  const clean = (value: DelegationRouting) => key === 'model_map'
    ? { default: value.model_map.default || null, options: value.model_map.options.map(row => cleanRow(row)) }
    : { default: value.profile_routes.default || null, profiles: value.profile_routes.profiles.map(row => cleanRow(row)) }
  if (JSON.stringify(stable(clean(expected))) !== JSON.stringify(stable(clean(actual)))) return false
  return key !== 'model_map' || expected.model_map.options.every(row => {
    const saved = actual.model_map.options.find(r => r.name === row.name)
    const action = row.credential?.action || 'keep'
    return Boolean(saved?.has_api_key) === (action === 'replace' || action === 'keep' && Boolean(row.has_api_key))
  })
}
