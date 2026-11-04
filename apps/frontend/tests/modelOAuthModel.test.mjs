import assert from 'node:assert/strict'
import test from 'node:test'
import { modelOAuthExpiry, modelOAuthPollDelay, modelOAuthTerminalMessage } from '../src/features/models/modelOAuthModel.ts'

test('OAuth polling follows the receiver interval within safe bounds', () => {
  assert.equal(modelOAuthPollDelay(5), 5000)
  assert.equal(modelOAuthPollDelay(0), 1000)
  assert.equal(modelOAuthPollDelay(999), 60000)
  assert.equal(modelOAuthPollDelay(Number.NaN), 2000)
})

test('OAuth terminal states keep receiver detail and localize fallback copy', () => {
  assert.equal(modelOAuthTerminalMessage('pending', null, true), null)
  assert.match(modelOAuthTerminalMessage('approved', null, true), /登录成功/)
  assert.equal(modelOAuthTerminalMessage('error', 'provider refused', true), 'provider refused')
  assert.match(modelOAuthTerminalMessage('expired', null, false), /expired/i)
})

test('OAuth expiry ignores invalid timestamps and reports expired credentials', () => {
  assert.equal(modelOAuthExpiry(null, true), null)
  assert.equal(modelOAuthExpiry('not-a-date', true), null)
  assert.equal(modelOAuthExpiry('2000-01-01T00:00:00Z', true), '已过期')
})
