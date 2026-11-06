import { mediaPathKey, nextCodeFence, renderMediaLine, type CodeFence } from './mediaModel.ts'

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

function previewPaths(lines: string[], supported: ReadonlySet<string>, streaming: boolean): Set<string> {
  const paths = new Set<string>()
  let fence: CodeFence | null = null
  const inline = { ticks: '' }
  for (const [index, line] of lines.entries()) {
    const next = nextCodeFence(line, fence)
    if (!fence && !next.boundary && !inline.ticks && (!streaming || index < lines.length - 1)) {
      const parsed = directive(line, supported)
      if (parsed?.name === 'preview' && parsed.attrs.file) paths.add(mediaPathKey(parsed.attrs.file))
    }
    if (!fence && !next.boundary) renderMediaLine(line, new Set(), false, inline)
    fence = next.fence
  }
  return paths
}

export function parseTranscriptParts(text: string, supported: ReadonlySet<string>, streaming = false): TranscriptPart[] {
  const lines = text.split(/\r?\n/)
  const previews = previewPaths(lines, supported, streaming)
  const parts: TranscriptPart[] = []
  let markdown = ''
  let fence: CodeFence | null = null
  const inline = { ticks: '' }

  const flush = () => {
    if (markdown.trim()) parts.push({ kind: 'markdown', value: markdown })
    markdown = ''
  }

  for (const [index, line] of lines.entries()) {
    const next = nextCodeFence(line, fence)
    const complete = !streaming || index < lines.length - 1
    const prose = !fence && !next.boundary && !/^ {4}|^\t/.test(line)
    const parsed = prose && !inline.ticks && complete ? directive(line, supported) : null
    if (parsed) {
      flush()
      parts.push(parsed)
    } else {
      const rendered = prose ? renderMediaLine(line, previews, complete, inline) : line
      if (rendered.trim() || !line.trim()) markdown += `${rendered}\n`
    }
    fence = next.fence
  }
  flush()
  return parts
}
