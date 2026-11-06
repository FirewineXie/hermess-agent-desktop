import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { presentKanbanEventPayload } from '../src/features/personal-tasks/kanbanEventPresentation.ts'

test('kanban event payload exposes status and diagnostic context', () => {
  const result = presentKanbanEventPayload(JSON.stringify({
    status: 'review', kind: 'stale_worker', severity: 'warning', title: 'Worker 心跳过期', reason: 'heartbeat_timeout', pid: 42,
  }))
  assert.match(result.context || '', /状态：review/)
  assert.match(result.context || '', /诊断：Worker 心跳过期/)
  assert.match(result.context || '', /原因：heartbeat_timeout/)
  assert.match(result.payload || '', /"pid": 42/)
})

test('kanban event payload redacts credentials and bounds nested data', () => {
  const result = presentKanbanEventPayload({
    token: 'top-secret', nested: { password: 'hidden', api_key: 'also-hidden' },
    rows: Array.from({ length: 30 }, (_, index) => ({ index, text: 'bounded' })),
  })
  assert.doesNotMatch(result.payload || '', /top-secret|also-hidden/)
  assert.match(result.payload || '', /\[已隐藏\]/)
  assert.match(result.payload || '', /另有 14 项/)
  assert.ok((result.payload || '').length <= 3_008)
})

test('kanban drawer opens child results and linked tasks in the same task flow', async () => {
  const source = await readFile(new URL('../src/features/personal-tasks/KanbanTaskDrawer.tsx', import.meta.url), 'utf8')
  assert.match(source, /onOpenTask\(child\.id\)/)
  assert.match(source, /onOpenTask\(link\.id\)/)
  assert.match(source, /presentKanbanEventPayload\(event\.payload\)/)
})

test('kanban event payload safely handles invalid and oversized text', () => {
  const invalid = presentKanbanEventPayload('authorization: Bearer abcdefghijklmnop <script>alert(1)</script>')
  assert.doesNotMatch(invalid.payload || '', /abcdefghijklmnop/)
  assert.match(invalid.payload || '', /\[已隐藏\]/)
  const oversized = presentKanbanEventPayload(`secret=${'a'.repeat(40_000)}`)
  assert.ok((oversized.payload || '').length <= 3_008)
  assert.doesNotMatch(oversized.payload || '', /a{100}/)
})
