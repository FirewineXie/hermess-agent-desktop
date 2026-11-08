import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { activateWorkspaceEpoch, useProfileState, workspaceKey } from '../src/app/profile-scope/ProfileWorkspace.ts'
import { captureChatDrafts } from '../src/features/chat/recoveryDrafts.ts'

function state(epoch, profile, slot, initial) {
  let value, set
  renderToString(React.createElement(() => {
    ;[value, set] = useProfileState(workspaceKey(epoch, profile), initial, slot)
    return null
  }))
  return { value, set }
}

test('Gateway replacement retains each profile draft and file attachments without retaining expired images or runtime state', () => {
  activateWorkspaceEpoch('before')
  const oldDraft = state('before', 'a', 'chat:draft', '')
  oldDraft.set('unsent A')
  state('before', 'b', 'chat:draft', '').set('unsent B')
  const file = { kind: 'file', source_path: 'notes.txt', ref_text: 'file reference' }
  state('before', 'a', 'chat:attachments', []).set([file, { kind: 'image', path: 'expired.png' }])
  state('before', 'a', 'chat:turn', false).set(true)
  const restoreDrafts = captureChatDrafts('before')
  assert.deepEqual([...restoreDrafts.profilesWithImages], ['a'])
  activateWorkspaceEpoch('after')
  restoreDrafts('after')
  assert.equal(state('after', 'a', 'chat:draft', '').value, 'unsent A')
  assert.equal(state('after', 'b', 'chat:draft', '').value, 'unsent B')
  assert.deepEqual(state('after', 'a', 'chat:attachments', []).value, [file])
  assert.equal(state('after', 'a', 'chat:turn', false).value, false)
  oldDraft.set('late stale write')
  assert.equal(state('after', 'a', 'chat:draft', '').value, 'unsent A')
})

test('a cancelled replacement cannot restore drafts into a different Gateway', () => {
  activateWorkspaceEpoch('local')
  state('local', 'default', 'chat:draft', '').set('local draft')
  const restore = captureChatDrafts('local')
  activateWorkspaceEpoch('remote')
  restore('replacement-local')
  assert.equal(state('remote', 'default', 'chat:draft', '').value, '')
})
