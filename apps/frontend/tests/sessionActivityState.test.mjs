import assert from 'node:assert/strict'
import test from 'node:test'
import { snapshotActivity, terminalActivity } from '../src/features/chat/sessionActivityState.ts'

test('a terminal event stays visible for an unopened session and clears in the open chat', () => {
  assert.equal(terminalActivity(false, false), 'completed')
  assert.equal(terminalActivity(false, true), 'failed')
  assert.equal(terminalActivity(true, false), undefined)
  assert.equal(terminalActivity(true, true), undefined)
})

test('running survives one transient idle snapshot but clears after two', () => {
  assert.equal(snapshotActivity('running', false, false, false, 1), 'running')
  assert.equal(snapshotActivity('running', false, false, false, 2), undefined)
  assert.equal(snapshotActivity('running', true, false, false, 0), 'running')
  assert.equal(snapshotActivity('running', false, true, true, 0), 'running')
  assert.equal(snapshotActivity('completed', false, false, false, 2), 'completed')
})
