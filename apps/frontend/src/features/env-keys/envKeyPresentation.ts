export type EnvKeyMetadata = {
  url: string | null
  tools: string[]
}

export function externalKeyUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

export function displayedTools(tools: string[]): string[] {
  return [...new Set(tools.map(tool => tool.trim()).filter(Boolean))]
}
