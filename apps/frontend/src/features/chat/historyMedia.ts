function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function persistedImages(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const markers = lines.filter(line => /^\[screenshot(?: detail=(?:low|high|auto))?\]$/.test(line))
  const hints = lines.flatMap(line => {
    const match = /^\[Image attached( at)?: (.+)\]$/.exec(line)
    return match ? [{ local: Boolean(match[1]), source: match[2] }] : []
  })
  // Match the locked fork's image_replay pairing. A lone typed hint or a lost
  // image path stays readable text; it cannot manufacture an attachment.
  if (!markers.length || markers.length !== hints.length) return []
  return [...new Set(hints.filter(hint => hint.local && /^(?:file:|\/|[a-z]:[\\/]|\\\\)/i.test(hint.source)).map(hint => hint.source))]
}

/** Preserve the image blocks used by the locked Gateway/provider message adapters. */
export function historyMedia(content: unknown): string[] {
  // Canonical session.resume reads the durable text projection, where images
  // are [screenshot] markers paired with retained file references.
  if (typeof content === 'string') return persistedImages(content)
  if (!Array.isArray(content)) return []
  const sources: string[] = []
  for (const value of content) {
    const part = record(value)
    if (!part) continue
    let source: unknown
    if (part.type === 'image_url') source = record(part.image_url)?.url
    if (part.type === 'image') {
      source = part.url
      const image = record(part.source)
      if (image?.type === 'url') source = image.url
      if (image?.type === 'base64' && typeof image.media_type === 'string' && /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/.test(image.media_type) && typeof image.data === 'string') {
        source = `data:${image.media_type};base64,${image.data}`
      }
    }
    if (typeof source === 'string' && /^(?:https?:\/\/|data:image\/|file:|\/|~\/|[a-z]:[\\/]|\\\\)/i.test(source) && !sources.includes(source)) sources.push(source)
  }
  return sources
}
