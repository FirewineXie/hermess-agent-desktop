import assert from 'node:assert/strict'
import test from 'node:test'
import { runSteerCommand } from '../src/features/chat/steerCommand.ts'

function setup(steerSession) {
  let draft = '/steer adjust the answer'
  let status = ''
  let current = true
  const inFlight = { current: false }
  const options = {
    chat: { steerSession }, scope: { kind: 'session', profile: 'default', sessionId: 's1' },
    draft, busy: true, hasAttachments: false, inFlight, isCurrent: () => current,
    language: 'en-US', setDraft: next => { draft = typeof next === 'function' ? next(draft) : next },
    setStatus: next => { status = next }, onQueued: () => {}, describeError: String,
  }
  return { options, state: () => ({ draft, status, inFlight: inFlight.current }), edit: next => { draft = next }, switchSession: () => { current = false } }
}

test('accepted steer clears only its own draft', async () => {
  const first = setup(async () => ({ status: 'queued' }))
  assert.equal(await runSteerCommand(first.options), true)
  assert.equal(first.state().draft, '')
  const second = setup(async () => ({ status: 'queued' }))
  second.edit('/steer a newer draft')
  assert.equal(await runSteerCommand(second.options), true)
  assert.equal(second.state().draft, '/steer a newer draft')
})

test('refused steer and session switch preserve input', async () => {
  const refused = setup(async () => ({ status: 'rejected', delivered: false }))
  assert.equal(await runSteerCommand(refused.options), false)
  assert.equal(refused.state().draft, '/steer adjust the answer')
  const switched = setup(async () => ({ status: 'queued' }))
  switched.switchSession()
  assert.equal(await runSteerCommand(switched.options), true)
  assert.equal(switched.state().draft, '/steer adjust the answer')
})
