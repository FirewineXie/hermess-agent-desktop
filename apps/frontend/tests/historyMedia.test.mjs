import assert from 'node:assert/strict'
import { test } from 'node:test'
import { historyTimeline } from '../src/features/chat/timeline.ts'
import { historyMedia } from '../src/features/chat/historyMedia.ts'
import { prepareMediaResource } from '../src/features/chat/mediaResource.ts'

test('structured content preserves images without requiring a text part and keeps their owning message', () => {
  const source = 'data:image/png;base64,aGVsbG8='
  const rows = historyTimeline([
    { role: 'user', timestamp: 10, content: [{ type: 'image_url', image_url: { url: source } }] },
    { role: 'assistant', timestamp: 12, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].role, 'user')
  assert.equal(rows[0].duration, 2)
  assert.deepEqual(rows[0].media, [source])
  assert.deepEqual(rows[1].media, [source])
})

test('known image URL variants retain Windows paths and deduplicate identical sources', () => {
  const path = 'C:\\Pictures\\结果.png'
  assert.deepEqual(historyMedia([
    { type: 'image_url', image_url: { url: path } },
    { type: 'image', url: path },
    { type: 'image', source: { type: 'url', url: 'https://example.test/result.png' } },
    { type: 'image', url: 'javascript:alert(1)' },
    { type: 'image_url', image_url: { url: 'ignored' } },
    { type: 'text', text: 'MEDIA:/tmp/text.png' },
  ]), [path, 'https://example.test/result.png'])
})

test('canonical persisted text recovers paired image paths while retaining the original notice', () => {
  const windows = 'C:\\Hermess\\profiles\\work\\native-inputs\\digest\\二维码.png'
  const mac = '/Users/test/Hermess/native-inputs/digest/photo.png'
  const content = `查看图片\n\n[Image attached at: ${windows}]\n[Image attached: https://example.test/old.png]\n[Image attached at: ${mac}]\n[screenshot]\n[screenshot detail=high]\n[screenshot detail=auto]`
  assert.deepEqual(historyMedia(content), [windows, mac])
  const rows = historyTimeline([{ role: 'user', content }])
  assert.equal(rows[0].text, content)
  assert.deepEqual(rows[0].media, [windows, mac])
  const mediaText = 'MEDIA:C:\\tmp\\shot.png'
  assert.equal(historyTimeline([{ role: 'assistant', content: mediaText }])[0].text, mediaText)
})

test('canonical missing references, mismatched marker counts and remote-only hints stay text', () => {
  for (const content of [
    '[screenshot]',
    '[Image attached at: /tmp/image.png]',
    '[Image attached at: /tmp/image.png]\n[screenshot]\n[screenshot]',
    '[Image attached at: image.png]\n[screenshot]',
    '[Image attached at: javascript:alert(1)]\n[screenshot]',
    '[Image attached: https://example.test/expired.png]\n[screenshot]',
    '[Image no longer retained]',
  ]) {
    assert.deepEqual(historyMedia(content), [])
    assert.equal(historyTimeline([{ role: 'user', content }])[0].text, content)
  }
})

test('restored image paths use the same default or named owning scope at the media boundary', async () => {
  const source = historyMedia('[Image attached at: /srv/hermes/native-inputs/hash/photo.png]\n[screenshot]')[0]
  for (const profile of ['default', 'work']) {
    const scope = { kind: 'session', profile, sessionId: 'stored-session', gatewayEpoch: 'owner-epoch' }
    const released = []
    const api = {
      prepare: async (receivedScope, receivedSource) => {
        assert.equal(receivedScope, scope)
        assert.equal(receivedSource, source)
        return { id: profile, name: 'photo.png', kind: 'image', mime: 'image/png', local: false, url: 'opaque-media-url' }
      },
      release: async id => { released.push(id) },
    }
    let ready = false
    const dispose = prepareMediaResource(api, scope, source, () => { ready = true }, () => assert.fail('unexpected prepare failure'))
    await Promise.resolve()
    assert.equal(ready, true)
    dispose()
    assert.deepEqual(released, [profile])
  }
})
