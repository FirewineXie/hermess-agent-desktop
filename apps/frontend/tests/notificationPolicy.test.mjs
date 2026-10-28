import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldNotify } from '../src/features/notifications/notificationPolicy.ts'

const active = { profile: 'default', sessionId: 'session-a' }
const other = { profile: 'writer', sessionId: 'session-b' }

test('completion notifications follow only the active session while away', () => {
  assert.equal(shouldNotify('turnDone', true, active, active), true)
  assert.equal(shouldNotify('turnError', true, other, active), false)
  assert.equal(shouldNotify('turnDone', false, active, active), false)
  assert.equal(shouldNotify('turnDone', true, undefined, active), false)
})

test('attention requests surface for another session or while away', () => {
  assert.equal(shouldNotify('approval', false, other, active), true)
  assert.equal(shouldNotify('input', false, active, active), false)
  assert.equal(shouldNotify('approval', true, active, active), true)
  assert.equal(shouldNotify('input', false, undefined, active), false)
})
