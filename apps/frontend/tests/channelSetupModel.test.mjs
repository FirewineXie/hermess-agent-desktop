import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addTelegramUserId,
  channelStatusTone,
  configuredWhatsAppMode,
  hasPendingChannelRestart,
  normalizeTelegramUserId,
  removeTelegramUserId,
  safeChannelDocsUrl,
  safeChannelIngressUrl,
  validateChannelField,
} from '../src/features/channels/channelSetupModel.ts'

test('channel runtime states keep dashboard status tones consistent', () => {
  assert.equal(channelStatusTone('connected'), 'success')
  assert.equal(channelStatusTone('pending_restart'), 'warning')
  assert.equal(channelStatusTone('degraded'), 'warning')
  assert.equal(channelStatusTone('startup_failed'), 'danger')
  assert.equal(channelStatusTone('not_configured'), 'neutral')
})

test('pending restart is recovered for every channel, not only the QR channels', () => {
  assert.equal(hasPendingChannelRestart([], false), false)
  assert.equal(hasPendingChannelRestart([], true), true)
  assert.equal(hasPendingChannelRestart([{ id: 'slack', state: 'pending_restart' }], false), true)
  assert.equal(hasPendingChannelRestart([{ id: 'telegram', state: 'pending_restart' }], false), true)
  assert.equal(hasPendingChannelRestart([{ id: 'whatsapp', state: 'pending_restart' }], false), true)
  assert.equal(hasPendingChannelRestart([{ id: 'telegram', state: 'connected' }], false), false)
})

test('Telegram allowlist accepts numeric IDs, trims and deduplicates', () => {
  assert.equal(normalizeTelegramUserId(' 123456 '), '123456')
  assert.equal(normalizeTelegramUserId('@owner'), null)
  assert.deepEqual(addTelegramUserId(['123'], ' 456 '), ['123', '456'])
  assert.deepEqual(addTelegramUserId(['123'], '123'), ['123'])
  assert.equal(addTelegramUserId(['123'], ''), null)
  assert.deepEqual(removeTelegramUserId(['123', '456'], '123'), ['456'])
})

test('generic channel validation mirrors locked Dashboard token and allowlist rules', () => {
  assert.deepEqual(validateChannelField('TELEGRAM_BOT_TOKEN', 'short'), { kind: 'telegram-token' })
  assert.equal(validateChannelField('TELEGRAM_BOT_TOKEN', '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'), null)
  assert.deepEqual(validateChannelField('TELEGRAM_ALLOWED_USERS', '123,@bad'), { kind: 'telegram-user', value: '@bad' })
  assert.deepEqual(validateChannelField('SLACK_BOT_TOKEN', 'xapp-wrong'), { kind: 'slack-token', prefix: 'xoxb-' })
  assert.equal(validateChannelField('SLACK_ALLOWED_USERS', '*,U01ABC2DEF3,W123'), null)
  assert.deepEqual(validateChannelField('SLACK_ALLOWED_USERS', 'channel-id'), { kind: 'slack-user', value: 'channel-id' })
})

test('WhatsApp mode falls back to bot for missing or untrusted metadata', () => {
  assert.equal(configuredWhatsAppMode('self-chat'), 'self-chat')
  assert.equal(configuredWhatsAppMode('bot'), 'bot')
  assert.equal(configuredWhatsAppMode('unexpected'), 'bot')
})

test('channel documentation and callback links accept only safe web URLs', () => {
  assert.equal(safeChannelDocsUrl('https://example.com/setup'), 'https://example.com/setup')
  assert.equal(safeChannelDocsUrl('http://example.com/setup'), null)
  assert.equal(safeChannelIngressUrl('http://127.0.0.1:8644/hooks/events'), 'http://127.0.0.1:8644/hooks/events')
  assert.equal(safeChannelIngressUrl('https://user:secret@example.com/hooks'), null)
  assert.equal(safeChannelIngressUrl('javascript:alert(1)'), null)
})
