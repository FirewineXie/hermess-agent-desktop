import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { mergeSidebarSessions, useSidebarSessions } from '../src/features/chat/useSidebarSessions.ts'
import { activateWorkspaceEpoch, useProfileState, workspaceKey } from '../src/app/profile-scope/ProfileWorkspace.ts'

const first = [{ id: 'first', title: '上方会话' }]
const second = [{ id: 'second', title: '下方会话' }]

test('switching Profiles preserves both lists before and after async inventory refresh', () => {
  let rows = mergeSidebarSessions({}, 'a', first, 'ready', { b: second })
  // Previously the selected list read an empty loading value while the other map
  // still contained only b: a disappeared, and b briefly disappeared as well.
  rows = mergeSidebarSessions(rows, 'b', [], 'loading', { b: second })
  assert.deepEqual(rows, { a: first, b: second })
  rows = mergeSidebarSessions(rows, 'b', [], 'loading', { a: first })
  assert.deepEqual(rows, { a: first, b: second })
  rows = mergeSidebarSessions(rows, 'b', second, 'ready', { a: first })
  assert.deepEqual(rows, { a: first, b: second })
  rows = mergeSidebarSessions(rows, 'a', [], 'loading', { a: first })
  assert.deepEqual(rows, { a: first, b: second })
})

test('a successful empty result removes deleted sessions, but loading and errors preserve known rows', () => {
  const previous = { a: first, b: second }
  for (const state of ['loading', 'error']) {
    assert.deepEqual(mergeSidebarSessions(previous, 'a', [], state, {}), previous)
  }
  assert.deepEqual(mergeSidebarSessions(previous, 'a', [], 'ready', {}), { a: [], b: second })
  assert.deepEqual(previous.a, first)
})

test('sidebar caches are separated by Gateway epoch', () => {
  activateWorkspaceEpoch('sidebar-old')
  let seedCache
  renderToString(React.createElement(() => {
    const [, setter] = useProfileState(workspaceKey('sidebar-old', 'sidebar'), {}, 'sidebar:session-lists')
    seedCache = setter
    return null
  }))
  seedCache({ a: first, b: second })
  const read = (epoch, profile, sessions, state, others) => {
    let value
    renderToString(React.createElement(() => {
      value = useSidebarSessions(epoch, profile, sessions, state, others)
      return null
    }))
    return value
  }
  assert.deepEqual(read('sidebar-old', 'a', [], 'loading', {}), { a: first, b: second })
  activateWorkspaceEpoch('sidebar-new')
  assert.deepEqual(read('sidebar-new', 'a', [], 'loading', {}), {})
})
