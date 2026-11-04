import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const channelsViewUrl = new URL('../src/features/channels/ChannelsView.tsx', import.meta.url)
const otherChannelsUrl = new URL('../src/features/channels/OtherChannels.tsx', import.meta.url)
const channelsCssUrl = new URL('../src/features/channels/channels.css', import.meta.url)
const zhLocaleUrl = new URL('../src/locales/app/ui.zh-CN.json', import.meta.url)

test('every channel dialog traps focus, supports escape, and restores its opener', async () => {
  const [featured, other] = await Promise.all([
    readFile(channelsViewUrl, 'utf8'),
    readFile(otherChannelsUrl, 'utf8'),
  ])

  assert.match(featured, /dialogOpenerRef\.current = document\.activeElement/)
  assert.match(featured, /dialogOpenerRef\.current\?\.focus\(\)/)
  assert.match(featured, /onKeyDown=\{keepFocusInside\}/)
  assert.match(other, /function handleDialogKeyDown/)
  assert.match(other, /event\.key === 'Escape'/)
  assert.match(other, /dialogOpenerRef\.current\?\.focus\(\)/)
  assert.equal([...other.matchAll(/role="dialog"/g)].length, [...other.matchAll(/onKeyDown=\{handleDialogKeyDown\}/g)].length)
})

test('channel QR layout prevents horizontal overflow and Chinese copy never falls back to the key', async () => {
  const [css, localeText] = await Promise.all([
    readFile(channelsCssUrl, 'utf8'),
    readFile(zhLocaleUrl, 'utf8'),
  ])
  const locale = JSON.parse(localeText)

  assert.match(css, /\.channel-qr \{[^}]*overflow-x: hidden;/)
  assert.match(css, /\.channel-access label\[data-selected="true"\]/)
  assert.equal(locale['ui.channels.pairing.once'], '只需扫描一次完成接入；如果后续私聊者收到 8 位配对码，可直接在渠道卡片中批准，无需重新扫码。')
})
