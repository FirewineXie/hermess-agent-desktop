import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeRecoveredRequests } from './requestRecovery.ts'

const request = (id, sessionId = 'active', answers = undefined) => ({
  id,
  method: 'clarify',
  params: { session_id: sessionId, questions: [{ qid: 'q1', question: 'Question?' }], answers },
})

test('a replayed cancellation does not restore a buffered request', () => {
  const cancelled = { type: 'request.cancel', session_id: 'active', seq: 7, payload: { id: 'srq-1' } }
  assert.deepEqual(mergeRecoveredRequests('active', [], [request('srq-1')], [cancelled], []), [])
})

test('a buffered cancellation wins even when snapshot watermark would skip its event', () => {
  const cancelled = { kind: 'request.cancel', session_id: 'active', seq: 7, payload: { id: 'srq-1' } }
  assert.deepEqual(mergeRecoveredRequests('active', [], [request('srq-1')], [], [cancelled]), [])
})

test('the open request keeps newer locked answers and unrelated sessions are ignored', () => {
  const open = request('srq-1', 'active', { q1: 'locked' })
  const buffered = request('srq-1')
  assert.deepEqual(mergeRecoveredRequests('active', [open], [buffered, request('srq-2', 'other')], [], [
    { kind: 'request.cancel', session_id: 'other', payload: { id: 'srq-1' } },
  ]), [open])
})
