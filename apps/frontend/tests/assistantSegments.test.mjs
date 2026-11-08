import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumeAssistantSegment, appendCompletedAssistant } from '../src/features/chat/assistantSegments.ts'

test('preserves media in streamed boundaries and unstreamed interims without duplicating the final answer', () => {
  const current = { current: 'MEDIA:C:\\tmp\\shot.png' }
  let rows = []
  let live = current.current
  const consume = event => consumeAssistantSegment(event, current, value => { live = value }, update => { rows = update(rows) })
  assert.equal(consume({ kind: 'message.delta', payload: { text: 'more' } }), false)
  assert.equal(consume({ kind: 'message.delta', payload: { text: null } }), true)
  assert.equal(rows[0].text, 'MEDIA:C:\\tmp\\shot.png')
  assert.equal(live, '')
  assert.equal(current.current, '')
  rows = appendCompletedAssistant(rows, 'MEDIA:C:\\tmp\\shot.png')
  assert.equal(rows.length, 1)
  consume({ kind: 'message.interim', payload: { text: 'MEDIA:/tmp/voice.mp3', already_streamed: false } })
  assert.equal(rows[1].text, 'MEDIA:/tmp/voice.mp3')
  consume({ kind: 'message.delta', payload: { text: null } })
  assert.equal(rows.length, 2)
  rows = appendCompletedAssistant(rows, 'Finished')
  assert.equal(rows[2].text, 'Finished')
})

test('canonical reuse flags settle media across tools only within the current turn', () => {
  const text = 'MEDIA:/tmp/result.png'
  const tools = { kind: 'tools', steps: [{ id: 'save', name: 'memory', state: 'finished' }] }
  const rows = [{ kind: 'message', role: 'user', text: 'Draw' }, { kind: 'message', role: 'assistant', text }, tools]
  assert.equal(appendCompletedAssistant(rows, text, { response_reused: true }), rows)
  assert.equal(appendCompletedAssistant(rows, text, { response_previewed: true }), rows)
  assert.equal(appendCompletedAssistant(rows, text).length, 4)
  assert.equal(appendCompletedAssistant(rows, 'Different final', { response_reused: true }).length, 4)
  const nextTurn = [...rows, { kind: 'message', role: 'user', text: 'Again' }, tools]
  assert.equal(appendCompletedAssistant(nextTurn, text, { response_reused: true }).length, 6)
})
