export type TranscriptDirective = { kind: 'directive'; name: string; attrs: Record<string, string> }
export type TranscriptPart = { kind: 'markdown'; value: string } | TranscriptDirective

const directivePattern = /^::([a-z][a-z\d-]*)\{(.*)\}$/i
const attributePattern = /([a-z][a-z\d-]*)="([^"\r\n]*)"/gi

function parseAttributes(value: string): Record<string, string> | null {
  const attrs: Record<string, string> = {}
  let consumed = 0
  for (const match of value.matchAll(attributePattern)) {
    if (value.slice(consumed, match.index).trim()) return null
    attrs[match[1]] = match[2]
    consumed = (match.index || 0) + match[0].length
  }
  return value.slice(consumed).trim() || !Object.keys(attrs).length ? null : attrs
}

function directive(line: string, supported: ReadonlySet<string>): TranscriptDirective | null {
  const match = line.trim().match(directivePattern)
  if (!match || !supported.has(match[1])) return null
  const attrs = parseAttributes(match[2])
  return attrs ? { kind: 'directive', name: match[1], attrs } : null
}

function pathKey(path: string): string {
  const trimmed = path.trim()
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(trimmed)
    ? trimmed.replaceAll('/', '\\').toLocaleLowerCase('en-US')
    : trimmed
}

function previewPaths(lines: string[], supported: ReadonlySet<string>): Set<string> {
  const paths = new Set<string>()
  let fenced = false
  for (const line of lines) {
    const fence = /^\s*```/.test(line)
    if (!fenced && !fence) {
      const parsed = directive(line, supported)
      if (parsed?.name === 'preview' && parsed.attrs.file) paths.add(pathKey(parsed.attrs.file))
    }
    if (fence) fenced = !fenced
  }
  return paths
}

export function parseTranscriptParts(text: string, supported: ReadonlySet<string>): TranscriptPart[] {
  const lines = text.split(/\r?\n/)
  const previews = previewPaths(lines, supported)
  const parts: TranscriptPart[] = []
  let markdown = ''
  let fenced = false

  const flush = () => {
    if (markdown.trim()) parts.push({ kind: 'markdown', value: markdown })
    markdown = ''
  }

  for (const line of lines) {
    const fence = /^\s*```/.test(line)
    const parsed = !fenced && !fence ? directive(line, supported) : null
    const media = !fenced && !fence ? line.trim().match(/^MEDIA:(.+)$/) : null
    if (parsed) {
      flush()
      parts.push(parsed)
    } else if (!(media && previews.has(pathKey(media[1])))) {
      markdown += `${line}\n`
    }
    if (fence) fenced = !fenced
  }
  flush()
  return parts
}
