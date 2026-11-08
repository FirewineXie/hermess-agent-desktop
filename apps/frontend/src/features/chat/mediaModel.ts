const MEDIA_HREF = '#hermess-media:'
const deliverableExtensions = 'png|jpe?g|gif|webp|bmp|tiff?|svg|avif|mp4|mov|avi|mkv|webm|3gp|mp3|m2a|wav|ogg|opus|m4a|flac|pdf|docx?|odt|rtf|txt|md|markdown|epub|xlsx?|ods|csv|tsv|json|xml|ya?ml|kmz|kml|geojson|gpx|pptx?|odp|key|zip|tar|gz|tgz|bz2|xz|7z|rar|apk|ipa|html?|xhtml'
const anchoredEnd = new RegExp(`\\.(?:${deliverableExtensions})(?=$|[\\s,;:!?，。；！、）)\\]}>]|\\.(?=\\s|$)|MEDIA:)`, 'i')
const pathStart = /^(?:[a-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])/i
const playableExtension = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|mp4|mov|avi|mkv|webm|mp3|wav|ogg|opus|m4a|flac)(?:[?#].*)?$/i

export function mediaName(source: string): string {
  if (/^data:/i.test(source)) return 'attachment'
  let path = source
  if (/^(?:https?|file):/i.test(source)) {
    try { path = decodeURIComponent(new URL(source).pathname) } catch { /* Keep a readable fallback. */ }
  }
  return path.split(/[\\/]/).filter(Boolean).at(-1) || source
}

export function mediaPathKey(source: string): string {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(source)
    ? source.replaceAll('/', '\\').toLocaleLowerCase('en-US')
    : source
}

export function mediaHref(source: string): string { return `${MEDIA_HREF}${encodeURIComponent(source)}` }

export function mediaSource(href: string): string | null {
  if (!href.startsWith(MEDIA_HREF)) return null
  try { return decodeURIComponent(href.slice(MEDIA_HREF.length)) || null } catch { return null }
}

/** All resource URLs are handed to the host; these are never DOM image URLs. */
export function isMediaSource(source: string): boolean {
  if (!source || /[\u0000-\u001f]/.test(source)) return false
  if (pathStart.test(source)) return true
  if (/^(?:https?|file|data):/i.test(source)) return true
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return false
  return /[/\\]|\.[^.]/.test(source)
}

export function isFileLink(source: string): boolean {
  if (/^https?:/i.test(source)) return playableExtension.test(source) || /\.(?:pdf|docx?|xlsx?|pptx?|zip|csv|txt|md|html?)(?:[?#].*)?$/i.test(source)
  return isMediaSource(source) && !source.startsWith('#')
}

/** GFM autolinks the URL inside an unfinished `![image](https://…`.
 * Admit the final streaming line only after an explicit Markdown delimiter.
 * `value` contains the parser's one synthetic final newline. */
export function pendingMarkdownMedia(value: string, start: number | undefined, end: number | undefined, streamingTail: boolean): boolean {
  if (!streamingTail) return false
  const rawValue = value.endsWith('\n') ? value.slice(0, -1) : value
  const lineStart = rawValue.lastIndexOf('\n') + 1
  const tail = rawValue.slice(lineStart)
  if (/^\s{0,3}\[[^\]]+\]:/.test(tail)) return true
  if (start == null || end == null) return true
  if (end <= lineStart) return false
  const raw = value.slice(start, end)
  return !((/^(?:!\[|\[)/.test(raw) && raw.endsWith(')')) || (raw.startsWith('<') && raw.endsWith('>')))
}

type Capture = { source: string; end: number }

function captureMedia(line: string, start: number): Capture | null {
  let cursor = start
  while (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1
  const quote = line[cursor]
  if (quote === '"' || quote === "'" || quote === '`') {
    const close = line.indexOf(quote, cursor + 1)
    if (close < 0) return null
    const source = line.slice(cursor + 1, close)
    return isMediaSource(source) ? { source, end: close + 1 } : null
  }
  const remaining = line.slice(cursor)
  const nextMarker = remaining.indexOf('MEDIA:')
  const candidate = nextMarker < 0 ? remaining : remaining.slice(0, nextMarker)
  // URLs use their normal no-whitespace boundary. Files may contain spaces;
  // a known extension provides an unambiguous boundary before following prose.
  const anchored = pathStart.test(candidate) ? anchoredEnd.exec(candidate) : null
  let source = anchored ? candidate.slice(0, anchored.index + anchored[0].length) : candidate.match(/^[^\s`"<>]+/)?.[0] || ''
  source = source.replace(/[.,;:!?，。；！、）)\]}]+$/, '')
  return isMediaSource(source) ? { source, end: cursor + source.length } : null
}

/** Rewrite only prose; inline code remains byte-for-byte unchanged. */
export type InlineCodeState = { ticks: string }

export function renderMediaLine(line: string, previews: ReadonlySet<string>, complete: boolean, inline: InlineCodeState = { ticks: '' }): string {
  let result = ''
  let index = 0
  while (index < line.length) {
    if (inline.ticks) {
      const closing = line.indexOf(inline.ticks, index)
      if (closing < 0) return result + line.slice(index)
      result += line.slice(index, closing + inline.ticks.length)
      index = closing + inline.ticks.length
      inline.ticks = ''
      continue
    }
    if (line[index] === '`') {
      const ticks = /^`+/.exec(line.slice(index))![0]
      inline.ticks = ticks
      result += ticks
      index += ticks.length
      continue
    }
    if (!line.startsWith('MEDIA:', index)) { result += line[index++]; continue }
    const capture = captureMedia(line, index + 6)
    // A last streaming line can still be a partial filename, even after .png.
    // Wait for a line boundary or turn completion rather than reading it early.
    if (!capture || !complete) { result += line[index++]; continue }
    if (!previews.has(mediaPathKey(capture.source))) {
      const label = mediaName(capture.source).replace(/[\\[\]]/g, '\\$&')
      result += `[${label}](${mediaHref(capture.source)})`
    }
    index = capture.end
  }
  return result
}

export type CodeFence = { marker: string; length: number }

export function nextCodeFence(line: string, fence: CodeFence | null): { boundary: boolean; fence: CodeFence | null } {
  const match = /^ {0,3}(?:> ?)*(?:(?:[-*+]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return { boundary: false, fence }
  if (!fence) return { boundary: true, fence: { marker: match[1][0], length: match[1].length } }
  if (match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) return { boundary: true, fence: null }
  return { boundary: false, fence }
}
