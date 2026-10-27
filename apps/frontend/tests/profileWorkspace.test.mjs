import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { activateWorkspaceEpoch, useProfileState, workspaceKey } from '../src/app/profile-scope/ProfileWorkspace.ts'

function readState(epoch, profile) {
  let setValue
  const html = renderToString(React.createElement(() => {
    const [value, setter] = useProfileState(workspaceKey(epoch, profile), '', 'epoch-test')
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
