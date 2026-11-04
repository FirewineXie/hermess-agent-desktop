import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKanbanTaskTree } from '../src/features/personal-tasks/kanbanTree.ts'

const tasks = ['root', 'child-a', 'grandchild', 'child-b', 'other'].map(id => ({ id, title: id, status: 'review' }))
const links = { root: ['child-a', 'child-b'], 'child-a': ['grandchild'] }

test('tasks in one status render parent, child, and deeper descendants in one ordered tree', () => {
  assert.deepEqual(
    buildKanbanTaskTree(tasks, links, new Set()).map(row => [row.task.id, row.depth, row.hasChildren]),
    [['root', 0, true], ['child-a', 1, true], ['grandchild', 2, false], ['child-b', 1, false], ['other', 0, false]],
  )
})

test('collapsing a parent task hides every descendant but keeps unrelated tasks', () => {
  assert.deepEqual(
    buildKanbanTaskTree(tasks, links, new Set(['root'])).map(row => row.task.id),
    ['root', 'other'],
  )
})

test('multiple parents choose the first visible parent and cycles never duplicate cards', () => {
  const rows = buildKanbanTaskTree(tasks, { root: ['child-a'], other: ['child-a'], 'child-a': ['root'] }, new Set())
  assert.deepEqual(new Set(rows.map(row => row.task.id)), new Set(tasks.map(task => task.id)))
  assert.equal(rows.length, tasks.length)
  assert.equal(rows.find(row => row.task.id === 'child-a')?.depth, 1)
})

test('a review root includes descendants from other workflow statuses', () => {
  const catalog = [
    { id: 'review-root', title: 'review-root', status: 'review' },
    { id: 'done-child', title: 'done-child', status: 'done' },
    { id: 'blocked-grandchild', title: 'blocked-grandchild', status: 'blocked' },
  ]
  const rows = buildKanbanTaskTree(
    [catalog[0]],
    { 'review-root': ['done-child'], 'done-child': ['blocked-grandchild'] },
    new Set(),
    catalog,
  )
  assert.deepEqual(rows.map(row => [row.task.id, row.task.status, row.depth]), [
    ['review-root', 'review', 0],
    ['done-child', 'done', 1],
    ['blocked-grandchild', 'blocked', 2],
  ])
})
