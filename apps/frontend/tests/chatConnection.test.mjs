import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionSnapshot, mergeConnectionSnapshot } from '../src/features/chat/connectionState.ts'
import { updateTool, updateToolActivity } from '../src/features/chat/timeline.ts'

const base = {
  op_id: 'abc12', seq: 2, deadline_at: 2000000000, tool_call_id: 'call-1',
  targets: [{ name: 'openviking', kind: 'plugin', state: 'pending', action: 'install' }],
}

test('connection state follows server operation sequence and preserves card metadata', () => {
  const initial = connectionSnapshot(base)
  const done = connectionSnapshot({ ...base, tool_call_id: null, seq: 4, settled: true,
    targets: [{ ...base.targets[0], state: 'connected' }] })
  const merged = mergeConnectionSnapshot(initial, done)
  assert.equal(merged.settled, true)
  assert.equal(merged.targets[0].state, 'connected')
  assert.equal(merged.tool_call_id, 'call-1')
  assert.deepEqual(mergeConnectionSnapshot(merged, initial), merged)
})

test('invalid operation frames cannot create a card', () => {
  assert.equal(connectionSnapshot({ ...base, targets: [null] }), null)
  assert.equal(connectionSnapshot({ ...base, seq: -1 }), null)
  assert.equal(connectionSnapshot({ ...base, op_id: 'foo\nbar' }), null)
})

test('tool progress and risk annotate the matching call without creating or reviving rows', () => {
  const rows = updateTool([], 'tool.start', { tool_id: 'call-1', name: 'mcp_example' })
  const missing = updateToolActivity(rows, 'tool.progress', { tool_id: 'other', percent: 25 })
  assert.equal(missing, rows)
  const progress = updateToolActivity(rows, 'tool.progress', { tool_id: 'call-1', percent: 25 })
  assert.equal(progress[0].steps[0].progress.percent, 25)
  const completed = updateTool(progress, 'tool.complete', { tool_id: 'call-1', name: 'mcp_example' })
  const late = updateToolActivity(completed, 'tool.progress', { tool_id: 'call-1', percent: 50 })
  assert.equal(late, completed)
  const risk = updateToolActivity(completed, 'tool.output_risk', { tool_id: 'call-1', risk: 'high', findings: ['fixture'] })
  assert.deepEqual(risk[0].steps[0].riskFindings, ['fixture'])
  assert.equal(risk[0].steps[0].state, 'finished')
})
