import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { kanbanReopenReview, kanbanRequestReview } from '../src/features/personal-tasks/kanbanApi.ts'
import { inspectKanbanReviewFlow } from '../src/features/personal-tasks/kanbanReviewFlow.ts'

function event(id, kind, payload) {
  return { id, kind, payload: payload == null ? null : JSON.stringify(payload) }
}

test('review flow detects both automated changes requests and manual review reopen', () => {
  const requested = event(10, 'review_requested', { implementer: 'builder', reviewer: 'reviewer' })
  const automated = inspectKanbanReviewFlow([
    requested,
    event(12, 'changes_requested', { implementer: 'builder', reviewer: 'reviewer', reason: '补充失败用例' }),
  ])
  assert.deepEqual(automated, {
    returnedForChanges: true,
    returnKind: 'changes_requested',
    reviewer: 'reviewer',
    implementer: 'builder',
    reason: '补充失败用例',
  })

  const manual = inspectKanbanReviewFlow([requested, { id: 13, kind: 'review_reopened', payload: { implementer: 'builder' } }])
  assert.equal(manual.returnedForChanges, true)
  assert.equal(manual.returnKind, 'review_reopened')
  assert.equal(manual.reviewer, 'reviewer')
})

test('a later review request closes the returned-for-changes phase', () => {
  const flow = inspectKanbanReviewFlow([
    event(1, 'review_requested', { implementer: 'builder', reviewer: 'reviewer-a' }),
    event(2, 'review_reopened', { implementer: 'builder' }),
    event(3, 'review_requested', { implementer: 'builder', reviewer: 'reviewer-b' }),
  ])
  assert.equal(flow.returnedForChanges, false)
  assert.equal(flow.reviewer, 'reviewer-b')
})

test('manual rejection records the reason before reopening review', async () => {
  const calls = []
  const bridge = {
    async request(path, method, body) {
      calls.push({ path, method, body })
      return { status: 200, body: {} }
    },
  }
  await kanbanReopenReview(bridge, 'main board', 'task/1', '修复边界条件')
  assert.deepEqual(calls, [
    {
      path: '/api/plugins/kanban/tasks/task%2F1/comments?board=main%20board',
      method: 'POST',
      body: { body: '修复边界条件', author: 'desktop-review' },
    },
    {
      path: '/api/plugins/kanban/tasks/task%2F1?board=main%20board',
      method: 'PATCH',
      body: { status: 'ready' },
    },
  ])
})

test('request review sends reviewer and handoff summary in one patch', async () => {
  const calls = []
  const bridge = {
    async request(path, method, body) {
      calls.push({ path, method, body })
      return { status: 200, body: {} }
    },
  }
  await kanbanRequestReview(bridge, 'main', 'task-1', 'reviewer', '已补充失败用例')
  assert.deepEqual(calls[0], {
    path: '/api/plugins/kanban/tasks/task-1?board=main',
    method: 'PATCH',
    body: { status: 'review', assignee: 'reviewer', summary: '已补充失败用例' },
  })
})

test('task drawer exposes explicit reject and re-review actions instead of ambiguous review moves', async () => {
  const source = await readFile(new URL('../src/features/personal-tasks/KanbanTaskDrawer.tsx', import.meta.url), 'utf8')
  assert.match(source, /退回给执行者修改/)
  assert.match(source, /重新提交审核/)
  assert.match(source, /请先填写需要修改的具体原因/)
  assert.match(source, /\['triage', 'todo', 'ready'\]\.includes\(status\)/)
})

test('task drawer blocks an implementer from reviewing the same task', async () => {
  const source = await readFile(new URL('../src/features/personal-tasks/KanbanTaskDrawer.tsx', import.meta.url), 'utf8')
  assert.match(source, /resolveReviewImplementer\(reviewFlow\.implementer, task\?\.assignee\)/)
  assert.match(source, /disabled=\{selfReview \|\| cannotReceiveReview/)
  assert.match(source, /执行者不能审核自己的任务，请选择其他 Profile/)
})
