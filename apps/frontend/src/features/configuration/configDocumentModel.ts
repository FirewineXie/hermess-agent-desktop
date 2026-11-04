export function isConfigDocument(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getField(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined, config)
}

function setField(config: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const root = structuredClone(config)
  const parts = path.split('.')
  let target = root
  for (const part of parts.slice(0, -1)) {
    const current = target[part]
    if (!current || typeof current !== 'object' || Array.isArray(current)) target[part] = {}
    target = target[part] as Record<string, unknown>
  }
  const leaf = parts.at(-1)
  if (leaf && value === undefined) delete target[leaf]
  else if (leaf) target[leaf] = structuredClone(value)
  return root
}

export function resetConfigFields(config: Record<string, unknown>, defaults: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return keys.reduce((next, key) => setField(next, key, getField(defaults, key)), config)
}
