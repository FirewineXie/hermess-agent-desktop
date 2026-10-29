import assert from 'node:assert/strict'
import test from 'node:test'
import { ExtendedNotificationTracker } from '../src/features/notifications/extendedNotifications.ts'
import { shouldNotify } from '../src/features/notifications/notificationPolicy.ts'

const event = (kind, payload, seq = 1, profile = 'default', session_id = 'session') => ({ kind, payload, seq, profile, session_id })

test('side tasks complete once per task and remain isolated by connection/Profile/session', () => {
  const tracker = new ExtendedNotificationTracker()
  const done = event('background.complete', { task_id: 'task', text: 'Finished' })
  assert.deepEqual(tracker.consume('one', done), { kind: 'backgroundDone', text: 'Finished', target: { profile: 'default', sessionId: 'session' } })
  assert.equal(tracker.consume('one', { ...done, seq: 2, payload: { ...done.payload, text: 'Replayed' } }), null)
  assert.ok(tracker.consume('two', done))
  assert.ok(tracker.consume('one', { ...done, profile: 'writer' }))
  assert.ok(tracker.consume('one', { ...done, session_id: 'another' }))
})

test('credits use producer keys, dedupe keyed states, and allow a new warning after clear', () => {
  const tracker = new ExtendedNotificationTracker()
  const warn = event('notification.show', { key: 'credits.depleted', text: 'Balance exhausted', level: 'error' })
  assert.equal(tracker.consume('one', warn).kind, 'credits')
  assert.equal(tracker.consume('one', { ...warn, seq: 2 }), null)
  assert.equal(tracker.consume('one', event('notification.clear', { key: 'credits.depleted' }, 3)), null)
  assert.equal(tracker.consume('one', { ...warn, seq: 2 }), null) // replay cannot resurrect an old state
  assert.ok(tracker.consume('one', { ...warn, seq: 4 }))
  assert.ok(tracker.consume('one', event('notification.show', { key: 'credits.restored', text: 'Restored', level: 'success' }, 5)))
})

test('plugin messages support keyed edits and sequence-free repeats', () => {
  const tracker = new ExtendedNotificationTracker()
  const notice = event('notification.show', { key: 'plugin-message:demo:123', text: 'First', level: 'info' })
  delete notice.seq
  assert.equal(tracker.consume('one', notice).kind, 'plugin')
  assert.equal(tracker.consume('one', notice), null)
  assert.equal(tracker.consume('one', { ...notice, payload: { ...notice.payload, text: 'Edited' } }).text, 'Edited')
  assert.equal(tracker.consume('one', notice).text, 'First')
})

test('unrelated notices, invalid payloads and unknown owners cannot trigger notifications', () => {
  const tracker = new ExtendedNotificationTracker()
  for (const invalid of [
    event('notification.show', { key: 'agent-loading', text: 'credits depleted' }),
    event('notification.show', { key: 'plugin.fake', text: 'message' }),
    event('notification.show', { key: 'credits.usage', text: 42 }),
    event('background.complete', { text: 'Missing task id' }),
    event('background.complete', { task_id: 'task', text: ' ' }),
    event('notification.show', { key: 'credits.usage', text: 'Warning' }, 1, ''),
    event('notification.show', { key: 'credits.usage', text: 'Warning' }, 1, 'default', ''),
  ]) assert.equal(tracker.consume('one', invalid), null)
})

test('extended notices require a background window and a known owner, including other sessions', () => {
  const target = { profile: 'p', sessionId: 's' }
  for (const kind of ['backgroundDone', 'credits', 'plugin']) {
    assert.equal(shouldNotify(kind, false, target, target), false)
    assert.equal(shouldNotify(kind, true, target, target), true)
    assert.equal(shouldNotify(kind, false, target, { profile: 'other', sessionId: 's' }), false)
    assert.equal(shouldNotify(kind, true, target, { profile: 'other', sessionId: 's' }), true)
    assert.equal(shouldNotify(kind, true, target, undefined), true)
    assert.equal(shouldNotify(kind, true, undefined, target), false)
  }
})

test('notice history is bounded and native notification bodies are truncated', () => {
  const tracker = new ExtendedNotificationTracker(2)
  const notice = key => event('notification.show', { key: `credits.${key}`, text: 'x'.repeat(400) })
  assert.equal(tracker.consume('one', notice('one')).text.length, 300)
  assert.ok(tracker.consume('one', notice('two')))
  assert.ok(tracker.consume('one', notice('three')))
  assert.ok(tracker.consume('one', notice('one')))
})
