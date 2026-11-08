import assert from 'node:assert/strict'
import test from 'node:test'
import { programmingProjects } from '../src/features/programming/programmingProjects.ts'

test('groups Windows aliases while retaining the real directory passed to new chats', () => {
  const rows = [{ id: 'first', cwd: 'C:\\Work\\App' }, { id: 'second', cwd: 'c:/work/app/' }]
  const projects = programmingProjects(rows, 'C:\\WORK\\APP')
  assert.equal(projects.length, 1)
  assert.equal(projects[0].name, 'App')
  assert.equal(projects[0].cwd, 'C:\\Work\\App')
  assert.deepEqual(projects[0].sessions.map(row => row.id), ['first', 'second'])
})

test('identical folder names in different parents remain separate projects', () => {
  const projects = programmingProjects([{ id: 'a', cwd: '/work/team-a/app' }, { id: 'b', cwd: '/work/team-b/app' }], '')
  assert.equal(projects.length, 2)
  assert.equal(projects[0].name, projects[1].name)
  assert.notEqual(projects[0].key, projects[1].key)
  assert.deepEqual(projects.map(project => project.sessions.map(row => row.id)), [['a'], ['b']])
})

test('POSIX case and literal backslashes are preserved; pending projects have no invented sessions', () => {
  const projects = programmingProjects([{ id: 'a', cwd: '/work/App' }], '/work/app\\source')
  assert.equal(projects.length, 2)
  assert.equal(projects[1].name, 'app\\source')
  assert.deepEqual(projects[1].sessions, [])
  assert.deepEqual(programmingProjects([], ''), [])
})

test('UNC aliases group together and POSIX root keeps its label', () => {
  const projects = programmingProjects([{ id: 'a', cwd: '\\\\server\\share\\Project' }], '\\\\SERVER\\SHARE\\PROJECT\\')
  assert.equal(projects.length, 1)
  assert.equal(projects[0].name, 'Project')
  assert.equal(programmingProjects([], '/')[0].name, '/')
})

test('editing a registered address keeps legacy and newly bound chats in one stable project', () => {
  const registry = [{ id: 'project-a', name: 'Website', cwd: '/work/new', legacy_cwds: ['/work/old'] }]
  const rows = [{ id: 'legacy', cwd: '/work/old' }, { id: 'bound', cwd: '/work/new', project_id: 'project-a' }]
  const grouped = programmingProjects(rows, '', registry)
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].key, 'project-a')
  assert.equal(grouped[0].cwd, '/work/new')
  assert.deepEqual(grouped[0].sessions.map(row => row.id), ['legacy', 'bound'])
})

test('an explicitly added empty project stays visible before its first chat', () => {
  const grouped = programmingProjects([], '', [{ id: 'empty', name: 'New app', cwd: '/work/app', legacy_cwds: [] }])
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].name, 'New app')
  assert.deepEqual(grouped[0].sessions, [])
})

test('archiving hides a chat without hiding its registered project, restoring shows it again', () => {
  for (const cwd of ['C:\\Work\\App', '/work/app']) {
    const registry = [{ id: 'project', name: 'Project', cwd, legacy_cwds: [] }]
    const row = { id: 'archived', project_id: 'project', cwd, archived: true }
    assert.deepEqual(programmingProjects([row], '', registry)[0].sessions, [])
    assert.deepEqual(programmingProjects([{...row,archived:false}], '', registry)[0].sessions.map(row => row.id), ['archived'])
    assert.deepEqual(programmingProjects([row], ''), [])
  }
})
