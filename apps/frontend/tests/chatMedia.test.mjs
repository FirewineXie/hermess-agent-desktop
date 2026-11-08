import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { mediaHref, isMediaSource, isFileLink } from '../src/features/chat/mediaModel.ts'
import { parseTranscriptParts } from '../src/features/chat/transcriptParts.ts'
import { prepareMediaResource } from '../src/features/chat/mediaResource.ts'
import { createPreviewWav } from '../src/preview/mediaFixtures.ts'

const supported = new Set(['preview'])
const markdown = (input, streaming = false) => parseTranscriptParts(input, supported, streaming).map(part => part.value || `PREVIEW:${part.attrs.file}`).join('')
const link = (path, label = path.split(/[/\\]/).at(-1)) => `[${label}](${mediaHref(path)})`

test('MEDIA delivers Windows screenshots, POSIX, home paths, quoted names and UNC spaces', () => {
  for (const path of [String.raw`C:\Users\demo.config\browser-harness\tmp\p-test\shot.png`, '/tmp/截图 1.png', '~/outputs/My Report.pdf', String.raw`\\server\share\My File.png`]) {
    assert.equal(markdown(`图片在这里\nMEDIA:${path}`), `图片在这里\n${link(path)}\n`)
  }
  for (const quote of ['"', "'", '`']) {
    assert.equal(markdown(`MEDIA:${quote}/tmp/a strange.unknown${quote}`), `${link('/tmp/a strange.unknown')}\n`)
  }
})

test('inline, multiple, relative, unknown extension, and terminal punctuation keep surrounding text', () => {
  assert.equal(markdown('看 MEDIA:/tmp/a.png；然后 MEDIA:report.xyz。'), `看 ${link('/tmp/a.png')}；然后 ${link('report.xyz')}。\n`)
  assert.equal(markdown("MEDIA:'/tmp/stop!.md'"), `${link('/tmp/stop!.md')}\n`)
  assert.equal(markdown('MEDIA: /tmp/a.pdf. 完成'), `${link('/tmp/a.pdf')}. 完成\n`)
  assert.equal(markdown('MEDIA:/tmp/my report.pdf. 完成'), `${link('/tmp/my report.pdf')}. 完成\n`)
  assert.equal(markdown('MEDIA:download MEDIA:... media:/tmp/a.png'), 'MEDIA:download MEDIA:... media:/tmp/a.png\n')
})

test('URL query and fragment remain part of the resource reference', () => {
  const path = 'https://example.invalid/a.png?version=2#frame'
  assert.equal(markdown(`MEDIA:${path}`), `${link(path, 'a.png')}\n`)
})

test('code fences, nested fence markers, inline code and indented examples remain literal', () => {
  for (const input of [
    '```\nMEDIA:/tmp/a.png\n```', '~~~\nMEDIA:/tmp/a.png\n~~~',
    '````\n```\nMEDIA:/tmp/a.png\n```\n````', '> ```\n> MEDIA:/tmp/a.png\n> ```',
    '`MEDIA:/tmp/a.png`', '``MEDIA:/tmp/a.png``', '`example\nMEDIA:/tmp/a.png\nend`',
    '    MEDIA:/tmp/a.png',
  ]) assert.equal(markdown(input), input + '\n')
  assert.equal(markdown('`MEDIA:/tmp/a.png` MEDIA:/tmp/b.png'), '`MEDIA:/tmp/a.png` ' + link('/tmp/b.png') + '\n')
})

test('existing explicit HTML preview suppresses only its matching MEDIA path', () => {
  const source = 'MEDIA:C:/Tmp/demo.html\nMEDIA:C:/Tmp/other.png\n::preview{file="c:\\tmp\\DEMO.html"}'
  assert.equal(markdown(source), link('C:/Tmp/other.png') + '\nPREVIEW:c:\\tmp\\DEMO.html')
  assert.match(markdown('MEDIA:/tmp/a.html\n```\n::preview{file="/tmp/a.html"}\n```'), /hermess-media:/)
})

test('streamed filename is not loaded until its line or turn completes', () => {
  for (const partial of ['MEDIA:', 'MEDIA:C:\\tmp\\shot', 'MEDIA:C:\\tmp\\shot.png', 'MEDIA:"/tmp/my image.png"']) {
    assert.equal(markdown(partial, true), partial + '\n')
  }
  assert.equal(markdown('MEDIA:/tmp/a.png\nmore', true), link('/tmp/a.png') + '\nmore\n')
  assert.equal(markdown('MEDIA:/tmp/a.png', false), link('/tmp/a.png') + '\n')
  assert.equal(markdown('::preview{file="/tmp/a.html"}', true), '::preview{file="/tmp/a.html"}\n')
})

test('resource candidates exclude executable protocols and recognize file and media links', () => {
  assert.equal(isMediaSource('javascript:alert(1)'), false)
  assert.equal(isMediaSource('vbscript:foo'), false)
  assert.equal(isMediaSource('data:image/png;base64,AAAA'), true)
  assert.equal(isFileLink('/tmp/report.pdf'), true)
  assert.equal(isFileLink('https://example.invalid/clip.mp4'), true)
  assert.equal(isFileLink('https://example.invalid/article'), false)
})

const scope = { kind: 'session', profile: 'default', sessionId: 's1', gatewayEpoch: 'g1' }
const resource = id => ({ id, name: 'shot.png', kind: 'image', mime: 'image/png', local: true, url: `asset://${id}` })
const tick = () => new Promise(resolve => setImmediate(resolve))

test('a late prepared resource is released without publishing after unmount', async () => {
  let settle
  const releases = [], results = []
  const api = { prepare: () => new Promise(resolve => { settle = resolve }), release: async id => { releases.push(id) } }
  const dispose = prepareMediaResource(api, scope, '/tmp/a.png', value => results.push(value), () => assert.fail('unexpected error'))
  dispose()
  settle(resource('late'))
  await tick()
  assert.deepEqual(results, [])
  assert.deepEqual(releases, ['late'])
})

test('active resources are released once and a failed request can be retried', async () => {
  const releases = [], results = []
  let errors = 0, attempts = 0
  const api = { prepare: async (receivedScope, source) => {
    assert.deepEqual(receivedScope, scope)
    assert.equal(source, '/tmp/a.png')
    if (!attempts++) throw new Error('missing')
    return resource('ready')
  }, release: async id => { releases.push(id) } }
  const first = prepareMediaResource(api, scope, '/tmp/a.png', value => results.push(value), () => { errors += 1 })
  await tick()
  first()
  const second = prepareMediaResource(api, scope, '/tmp/a.png', value => results.push(value), () => { errors += 1 })
  await tick()
  second(); second()
  await tick()
  assert.equal(errors, 1)
  assert.deepEqual(results.map(value => value.id), ['ready'])
  assert.deepEqual(releases, ['ready'])
})

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
after(() => server.close())
const { default: MarkdownMessage } = await server.ssrLoadModule('/src/features/chat/components/MarkdownMessage.tsx')
const { ChatMediaProvider } = await server.ssrLoadModule('/src/features/chat/ChatMediaContext.tsx')
const { DesktopProvider } = await server.ssrLoadModule('/src/app/DesktopContext.tsx')

test('without an owning session media references remain readable and do not become broken raw images', () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownMessage, { text: 'MEDIA:C:\\tmp\\shot.png\n![截图](/tmp/a.png)\n[文档](/tmp/a.pdf)', language: 'zh-CN' }))
  assert.match(html, /shot.png/)
  assert.match(html, /连接对应会话/)
  assert.doesNotMatch(html, /<img|src="C:|href="\/tmp/)
})

test('owned MEDIA and Markdown resources share the loading component; normal hyperlinks stay links', () => {
  const html = renderToStaticMarkup(React.createElement(DesktopProvider, { api: { media: {} } }, React.createElement(ChatMediaProvider, { scope }, React.createElement(MarkdownMessage, {
    text: 'MEDIA:/tmp/a.png\n![音频](/tmp/a.mp3)\n[视频](https://example.invalid/a.mp4)\n[网页](https://example.invalid/docs)', language: 'zh-CN',
  }))))
  assert.equal((html.match(/data-media-kind="loading"/g) || []).length, 3)
  assert.match(html, /href="https:\/\/example.invalid\/docs"/)
  assert.doesNotMatch(html, /<img[^>]+src="\/tmp|href="javascript:/)
})

test('unfinished streaming Markdown URLs never trigger media preparation through GFM autolinks', () => {
  const render = (text, streaming) => renderToStaticMarkup(React.createElement(DesktopProvider, { api: { media: {} } }, React.createElement(ChatMediaProvider, { scope }, React.createElement(MarkdownMessage, { text, streaming, language: 'zh-CN' }))))
  for (const input of ['![img](/tmp/a.png', '![img](https://example.invalid/a.png', '[file](https://example.invalid/a.pdf', 'https://example.invalid/a.png']) {
    assert.doesNotMatch(render(input, true), /data-media-kind/)
  }
  for (const input of ['![img](/tmp/a.png)', '[file](https://example.invalid/a.pdf)', '<https://example.invalid/a.png>', 'https://example.invalid/a.png\n']) {
    assert.match(render(input, true), /data-media-kind="loading"/)
  }
  assert.match(render('https://example.invalid/a.png', false), /data-media-kind="loading"/)
  assert.doesNotMatch(render('![img][ref]\n\n[ref]: https://example.invalid/a.png', true), /data-media-kind/)
})

test('audio preview fixture is a complete one-second PCM WAV generated in memory', async () => {
  const wav = createPreviewWav()
  const bytes = Buffer.from(await wav.arrayBuffer())
  assert.equal(wav.type, 'audio/wav')
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE')
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length)
  assert.equal(bytes.readUInt32LE(24), 16000)
  assert.equal(bytes.readUInt16LE(34), 16)
  assert.equal(bytes.readUInt32LE(40), 32000)
  assert.notEqual(bytes.readInt16LE(44 + 450 * 2), 0)
})
