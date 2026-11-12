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

test('featured channel QR starts polling immediately without a second confirmation step', async () => {
  const [channels, css, localeText] = await Promise.all([
    readFile(channelsViewUrl, 'utf8'),
    readFile(channelsCssUrl, 'utf8'),
    readFile(zhLocaleUrl, 'utf8'),
  ])
  const locale = JSON.parse(localeText)

  assert.match(css, /\.channel-qr \{[^}]*overflow-x: hidden;/)
  assert.doesNotMatch(channels, /accessConfirmed|channels\.access\.confirm|type="radio"/)
  assert.match(channels, /channels\.poll\(scope\(active\.profile\), active\.qr\.id, 'open'/)
  assert.match(channels, /void poll\(\)/)
  assert.equal(locale['ui.channels.scan.once'], '只需扫描这一个二维码；页面会自动检查登录结果。')
})
