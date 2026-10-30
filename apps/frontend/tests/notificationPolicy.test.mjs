import assert from 'node:assert/strict'
import test from 'node:test'
import { eventNotificationKey, NotificationDeduper, requestNotificationKey, shouldNotify } from '../src/features/notifications/notificationPolicy.ts'
import { defaultNotificationPreferences, notificationPreferencesKey, readNotificationPreferences, writeNotificationPreferences } from '../src/features/notifications/preferences.ts'

const active = { profile: 'default', sessionId: 'session-a' }

test('attention requests notify in the background or for another session', () => {
  assert.equal(shouldNotify('approval', false, active, active), false)
  assert.equal(shouldNotify('input', true, active, active), true)
  assert.equal(shouldNotify('approval', false, { profile: 'default', sessionId: 'session-b' }, active), true)
})

test('completion only notifies for the active session while backgrounded', () => {
  assert.equal(shouldNotify('turnDone', true, active, active), true)
  assert.equal(shouldNotify('turnError', false, active, active), false)
  assert.equal(shouldNotify('turnDone', true, { profile: 'other', sessionId: 'session-a' }, active), false)
})

test('event and request identities include the connection and owner', () => {
  assert.notEqual(eventNotificationKey('one', { kind: 'message.complete', profile: 'p', session_id: 's', seq: 1 }), eventNotificationKey('two', { kind: 'message.complete', profile: 'p', session_id: 's', seq: 1 }))
  assert.notEqual(requestNotificationKey('one', { id: 'r', method: 'approval', profile: 'p', params: { session_id: 's' } }), requestNotificationKey('one', { id: 'r', method: 'approval', profile: 'q', params: { session_id: 's' } }))
})

test('deduper rejects repeats and evicts old entries at its bound', () => {
  const deduper = new NotificationDeduper(2)
  assert.equal(deduper.add('a'), true)
  assert.equal(deduper.add('a'), false)
  assert.equal(deduper.add('b'), true)
  assert.equal(deduper.add('c'), true)
  assert.equal(deduper.add('a'), true)
})

test('preferences use only the current key and merge defaults', () => {
  const values = new Map([[notificationPreferencesKey, JSON.stringify({ sound: false })], ['hermess.desktop.notifications.v1', JSON.stringify({ enabled: false })]])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  assert.deepEqual(readNotificationPreferences(storage), { ...defaultNotificationPreferences, sound: false })
  writeNotificationPreferences({ ...defaultNotificationPreferences, enabled: false }, storage)
  assert.equal(JSON.parse(values.get(notificationPreferencesKey)).enabled, false)
})
