import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addWorkspace,
  migrateLegacySelection,
  readWorkspacePreferences,
  removeWorkspace,
  removeWorkspaceProfile,
  renameWorkspaceProfile,
  selectedWorkspace,
  selectWorkspace,
} from '../src/features/workspaces/workspacePreferences.ts'

test('migrates the previous global selection to the first active Agent only', () => {
  const previous = JSON.stringify({ paths: ['C:/Work/Alpha'], selected: 'c:/work/alpha/' })
  const loaded = readWorkspacePreferences(null, previous)

  assert.equal(selectedWorkspace(loaded, 'research'), 'C:\\Work\\Alpha')
  const migrated = migrateLegacySelection(loaded, 'research')
  assert.equal(selectedWorkspace(migrated, 'research'), 'C:\\Work\\Alpha')
  assert.equal(selectedWorkspace(migrated, 'writer'), '')
  assert.equal(migrated.legacySelected, undefined)
})

test('keeps each Agent default workspace independent', () => {
  let preferences = readWorkspacePreferences(JSON.stringify({
    paths: ['C:\\Work\\Alpha', 'C:\\Work\\Beta'],
    selectedByProfile: {},
  }), null)

  preferences = selectWorkspace(preferences, 'research', 'C:\\Work\\Alpha')
  preferences = selectWorkspace(preferences, 'writer', 'C:\\Work\\Beta')
  assert.equal(selectedWorkspace(preferences, 'research'), 'C:\\Work\\Alpha')
  assert.equal(selectedWorkspace(preferences, 'writer'), 'C:\\Work\\Beta')

  preferences = selectWorkspace(preferences, 'research', '')
  assert.equal(selectedWorkspace(preferences, 'research'), '')
  assert.equal(selectedWorkspace(preferences, 'writer'), 'C:\\Work\\Beta')
})

test('allows multiple Agents to share the same default workspace', () => {
  let preferences = readWorkspacePreferences(JSON.stringify({
    paths: ['C:\\Work\\Shared'],
    selectedByProfile: {},
  }), null)

  preferences = selectWorkspace(preferences, 'research', 'C:\\Work\\Shared')
  preferences = selectWorkspace(preferences, 'writer', 'C:\\Work\\Shared')
  assert.equal(selectedWorkspace(preferences, 'research'), 'C:\\Work\\Shared')
  assert.equal(selectedWorkspace(preferences, 'writer'), 'C:\\Work\\Shared')
})

test('adding a folder selects it for the current Agent without duplicating equivalent Windows paths', () => {
  let preferences = readWorkspacePreferences(null, null)
  preferences = addWorkspace(preferences, 'research', 'C:/Work/Alpha')
  preferences = addWorkspace(preferences, 'writer', 'c:\\work\\alpha\\')

  assert.deepEqual(preferences.paths, ['C:\\Work\\Alpha'])
  assert.equal(selectedWorkspace(preferences, 'research'), 'C:\\Work\\Alpha')
  assert.equal(selectedWorkspace(preferences, 'writer'), 'C:\\Work\\Alpha')
})

test('removing a shortcut clears every Agent default that points to it', () => {
  let preferences = readWorkspacePreferences(JSON.stringify({
    paths: ['C:\\Work\\Alpha', 'C:\\Work\\Beta'],
    selectedByProfile: { research: 'C:\\Work\\Alpha', writer: 'C:\\Work\\Beta' },
  }), null)

  preferences = removeWorkspace(preferences, 'c:/work/alpha/')
  assert.deepEqual(preferences.paths, ['C:\\Work\\Beta'])
  assert.equal(selectedWorkspace(preferences, 'research'), '')
  assert.equal(selectedWorkspace(preferences, 'writer'), 'C:\\Work\\Beta')
})

test('rejects a default that is not in the shared shortcut list', () => {
  const preferences = readWorkspacePreferences(JSON.stringify({
    paths: ['C:\\Work\\Alpha'],
    selectedByProfile: { research: 'C:\\Work\\Alpha' },
  }), null)
  const unchanged = selectWorkspace(preferences, 'research', 'C:\\Work\\Missing')

  assert.equal(selectedWorkspace(unchanged, 'research'), 'C:\\Work\\Alpha')
})

test('an explicit runtime default is not replaced by a pending legacy selection', () => {
  const preferences = readWorkspacePreferences(JSON.stringify({
    paths: ['C:\\Work\\Alpha'],
    selectedByProfile: { research: '' },
    legacySelected: 'C:\\Work\\Alpha',
  }), null)

  assert.equal(selectedWorkspace(preferences, 'research'), '')
  assert.equal(selectedWorkspace(migrateLegacySelection(preferences, 'research'), 'research'), '')
})

test('keeps Agent defaults aligned when an Agent is renamed or deleted', () => {
  const preferences = readWorkspacePreferences(JSON.stringify({
    paths: ['C:\\Work\\Alpha'],
    selectedByProfile: { research: 'C:\\Work\\Alpha' },
  }), null)

  const renamed = renameWorkspaceProfile(preferences, 'research', 'analyst')
  assert.equal(selectedWorkspace(renamed, 'research'), '')
  assert.equal(selectedWorkspace(renamed, 'analyst'), 'C:\\Work\\Alpha')

  const removed = removeWorkspaceProfile(renamed, 'analyst')
  assert.equal(selectedWorkspace(removed, 'analyst'), '')
})
