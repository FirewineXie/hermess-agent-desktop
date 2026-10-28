import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { activateWorkspaceEpoch, discardProfileFeatureState, useProfileState, workspaceKey } from '../src/app/profile-scope/ProfileWorkspace.ts'

function readState(epoch, profile, slot = 'epoch-test') {
  let setValue
  const html = renderToString(React.createElement(() => {
    const [value, setter] = useProfileState(workspaceKey(epoch, profile), '', slot)
    setValue = setter
    return React.createElement('span', null, value)
  }))
  return { html, setValue }
}

test('Profile state survives view switches and rejects writes from a retired Gateway epoch', () => {
  activateWorkspaceEpoch('test-epoch-1')
  const a = readState('test-epoch-1', 'a')
  a.setValue('A draft')
  assert.equal(readState('test-epoch-1', 'b').html, '<span></span>')
  assert.equal(readState('test-epoch-1', 'a').html, '<span>A draft</span>')

  activateWorkspaceEpoch('test-epoch-2')
  a.setValue('late response')
  assert.equal(readState('test-epoch-2', 'a').html, '<span></span>')
  assert.equal(readState('test-epoch-1', 'a').html, '<span></span>')
})

test('a backend without an epoch still retires callbacks when it stops', () => {
  const firstGeneration = activateWorkspaceEpoch(null, true)
  const old = readState(null, 'a')
  old.setValue('old runtime')
  const nextGeneration = activateWorkspaceEpoch(null, true)
  assert.equal(nextGeneration, firstGeneration + 1)
  old.setValue('late response')
  assert.equal(readState(null, 'a').html, '<span></span>')
})

test('ordinary Profile switches keep the Gateway generation stable', () => {
  const generation = activateWorkspaceEpoch('test-shared-gateway')
  readState('test-shared-gateway', 'a').setValue('A')
  readState('test-shared-gateway', 'b').setValue('B')
  assert.equal(activateWorkspaceEpoch('test-shared-gateway'), generation)
  assert.equal(readState('test-shared-gateway', 'a').html, '<span>A</span>')
  assert.equal(readState('test-shared-gateway', 'b').html, '<span>B</span>')
})

test('different connections never share state even when Gateway epochs match', () => {
  const epoch = 'same-server-epoch'
  const first = '6c6575e6-633c-4ebd-a31e-557ced8d6ac1'
  const second = '1513d72d-af0e-4aac-925d-e5d30bb8b173'
  activateWorkspaceEpoch(epoch, false, first)
  const stale = readState(epoch, 'writer')
  stale.setValue('connection A draft')
  assert.equal(readState(epoch, 'writer').html, '<span>connection A draft</span>')
  activateWorkspaceEpoch(epoch, false, second)
  stale.setValue('late A response')
  assert.equal(readState(epoch, 'writer').html, '<span></span>')
  readState(epoch, 'writer').setValue('connection B draft')
  assert.equal(readState(epoch, 'writer').html, '<span>connection B draft</span>')
})

test('discarding one Profile feature removes its drafts and rejects late writes', () => {
  const epoch = 'discard-epoch'
  activateWorkspaceEpoch(epoch)
  const oldAgent = readState(epoch, 'a', 'agent-settings:4')
  oldAgent.setValue('unsaved draft')
  readState(epoch, 'a', 'other-feature:1').setValue('keep')
  readState(epoch, 'b', 'agent-settings:4').setValue('other Profile')
  discardProfileFeatureState(workspaceKey(epoch, 'a'), 'agent-settings')
  oldAgent.setValue('late stale write')
  assert.equal(readState(epoch, 'a', 'agent-settings:4').html, '<span></span>')
  assert.equal(readState(epoch, 'a', 'other-feature:1').html, '<span>keep</span>')
  assert.equal(readState(epoch, 'b', 'agent-settings:4').html, '<span>other Profile</span>')
})
