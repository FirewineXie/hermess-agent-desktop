export function marketLink(...candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href
    } catch { /* A source label or catalog identifier is not a web link. */ }
  }
  return null
}
