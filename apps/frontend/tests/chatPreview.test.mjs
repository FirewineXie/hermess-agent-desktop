import assert from 'node:assert/strict'
import test from 'node:test'
import { htmlPreviewSandbox, PREVIEW_LOAD_MESSAGE } from '../src/features/chat/htmlPreviewSandbox.ts'
import { parseTranscriptParts } from '../src/features/chat/transcriptParts.ts'

const supported = new Set(['preview', 'task'])

test('deduplicates a MEDIA path when the same file has an inline preview', () => {
  const path = 'C:\\Users\\demo\\outputs\\snake.html'
  const parts = parseTranscriptParts(`文件在这里：\nMEDIA:${path}\n::preview{file="${path}"}\n完成`, supported)
  assert.deepEqual(parts, [
    { kind: 'markdown', value: '文件在这里：\n' },
    { kind: 'directive', name: 'preview', attrs: { file: path } },
    { kind: 'markdown', value: '完成\n' },
  ])
})

test('keeps unmatched MEDIA references and directives inside code fences as text', () => {
  const text = 'MEDIA:C:\\tmp\\report.pdf\n```\n::preview{file="C:\\tmp\\inside.html"}\n```'
  assert.deepEqual(parseTranscriptParts(text, supported), [{ kind: 'markdown', value: `${text}\n` }])
})

test('parses registered directives generically and leaves unknown directives as text', () => {
  const parts = parseTranscriptParts('::task{id="BB-12" label="Review"}\n::unknown{id="x"}', supported)
  assert.deepEqual(parts, [
    { kind: 'directive', name: 'task', attrs: { id: 'BB-12', label: 'Review' } },
    { kind: 'markdown', value: '::unknown{id="x"}\n' },
  ])
})

test('builds a fixed sandbox shell without embedding artifact HTML', () => {
  const shell = htmlPreviewSandbox('preview-token-1')
  assert.match(shell, /sandbox|Content-Security-Policy/)
  assert.match(shell, /default-src 'none'/)
  assert.match(shell, /connect-src 'none'/)
  assert.match(shell, /frame-src 'none'/)
  assert.match(shell, /event\.source !== parent/)
  assert.match(shell, /script:not\(\[data-hermess-shell\]\)/)
  assert.match(shell, new RegExp(PREVIEW_LOAD_MESSAGE))
  assert.throws(() => htmlPreviewSandbox('bad\"token'))
})
