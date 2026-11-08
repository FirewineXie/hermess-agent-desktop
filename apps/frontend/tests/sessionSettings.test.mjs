import assert from 'node:assert/strict'
import test from 'node:test'
import { settingsCategories, settingsPages } from '../src/features/settings/model.ts'
import { archivedSessions } from '../src/features/session-management/sessionArchive.ts'

test('sessions has a Profile-scoped entry with direct auto archive and archived pages', () => {
  const category = settingsCategories.find(item => item.id === 'sessions')
  assert.equal(category.zh, '会话')
  assert.equal(category.profileScoped, true)
  assert.equal(category.page, 'session-auto-archive')
  assert.deepEqual(settingsPages.filter(item => item.category === 'sessions').map(item => item.id), [
    'session-auto-archive', 'archived-sessions', 'sessions',
  ])
  for (const item of settingsCategories) {
    assert.equal(settingsPages.find(page => page.id === item.page)?.category, item.id)
  }
})

test('archived page excludes unarchived pinned backfill and search hits', () => {
  const rows = [
    {id:'archived',archived:true},
    {id:'pinned',archived:false,pinned:true},
    {id:'recent',archived:false},
    {id:'unknown'},
  ]
  assert.deepEqual(archivedSessions(rows).map(row => row.id), ['archived'])
  assert.equal(rows.length, 4)
})

test('Codex archives belong to global programming settings, separate from Profile session archives', () => {
  assert.equal(settingsPages.find(page => page.id === 'programming-archives').category, 'programming')
  assert.equal(settingsCategories.find(category => category.id === 'programming').profileScoped, false)
  assert.notEqual(settingsPages.find(page => page.id === 'archived-sessions').category, 'programming')
})
