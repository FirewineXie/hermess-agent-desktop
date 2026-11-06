import dashboardEn from './generated/dashboard.en.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeTranslations(base: unknown, overrides: unknown): unknown {
  if (!isRecord(base) || !isRecord(overrides)) return overrides ?? base
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue
    result[key] = isRecord(result[key]) && isRecord(value)
      ? mergeTranslations(result[key], value)
      : value
  }
  return result
}

export function defineDashboardLocale(overrides: unknown): typeof dashboardEn {
  return mergeTranslations(dashboardEn, overrides) as typeof dashboardEn
}
