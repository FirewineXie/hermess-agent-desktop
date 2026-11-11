import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendReasoning, finishReasoning, historyTimeline, pauseReasoning, updateTool } from '../src/features/chat/timeline.ts'
import { sessionSourceLabel } from '../src/features/chat/sessionSource.ts'

test('typed task notifications are collapsed notices, never human questions or timed turns', () => {
  const raw = '[ASYNC DELEGATION BATCH COMPLETE] internal routing and logs'
  const timeline = historyTimeline([
    { role: 'user', content: '请检查项目', timestamp: 10 },
    { role: 'assistant', content: '已启动子任务。', timestamp: 11 },
    { role: 'user', content: raw, timestamp: 12, display_kind: 'async_delegation_complete', display_metadata: { display_text: 'Subagent Task Completed: 检查项目' } },
    { role: 'assistant', content: '检查完成，没有发现问题。', timestamp: 14 },
    { role: 'user', content: 'hidden control', display_kind: 'hidden' },
    { role: 'user', content: 'internal heartbeat', display_kind: 'internal_notification' },
  ])
  assert.equal(timeline.filter(item => item.kind === 'message' && item.role === 'user').length, 1)
  assert.equal(timeline[0].duration, 1)
  assert.deepEqual(timeline[2], { kind: 'task-notice', task: 'subagent', title: 'Subagent Task Completed: 检查项目', text: raw })
  assert.equal(timeline.at(-1).text, '检查完成，没有发现问题。')
})

test('ordinary user and assistant JSON or notification-looking text is preserved', () => {
  const text = '[ASYNC DELEGATION BATCH COMPLETE] {"status":"dispatched"}'
  assert.deepEqual(historyTimeline([{ role: 'user', content: text }, { role: 'assistant', content: text }]).map(item => item.text), [text, text])
  assert.equal(historyTimeline([{ role: 'user', content: 'process log', display_kind: 'process_complete' }])[0].task, 'process')
  assert.equal(historyTimeline([{ role: 'user', content: 'future feature', display_kind: 'unknown' }])[0].role, 'user')
})

test('restored channel history shows user and assistant content alongside reasoning', () => {
  const timeline = historyTimeline([
    { role: 'user', content: [{ type: 'text', text: '渠道提问' }, { type: 'image_url', image_url: { url: 'ignored' } }], timestamp: 10 },
    { role: 'assistant', content: '正文回答', reasoning_content: '思考过程', timestamp: 12 },
  ])
  assert.deepEqual(timeline.map(item => [item.kind, item.text]), [
    ['message', '渠道提问'], ['reasoning', '思考过程'], ['message', '正文回答'],
  ])
  assert.equal(sessionSourceLabel('weixin', 'zh-CN'), '微信')
  assert.equal(sessionSourceLabel('feishu', 'zh-CN'), '飞书')
  assert.equal(sessionSourceLabel('desktop', 'zh-CN'), '')
})

test('older text rows remain visible', () => {
  assert.deepEqual(historyTimeline([{ role: 'user', text: '旧问题' }, { role: 'assistant', text: '旧回答' }])
    .filter(item => item.kind === 'message').map(item => item.text), ['旧问题', '旧回答'])
})

test('running restored turn is not marked complete by persisted assistant reasoning', () => {
  const timeline = historyTimeline([
    { role: 'user', text: '请选择文件名', timestamp: 10 },
    { role: 'assistant', reasoning: 'I will call clarify.', timestamp: 13 },
  ], true)
  assert.equal(timeline[0].kind, 'message')
  assert.equal(timeline[0].turnState, undefined)
  assert.equal(timeline[0].duration, undefined)
})

test('reasoning without a final assistant answer never completes a restored turn', () => {
  const timeline = historyTimeline([
    { role: 'user', text: '请选择文件名', timestamp: 10 },
    { role: 'assistant', reasoning: 'I will call clarify.', timestamp: 13 },
  ])
  assert.equal(timeline[0].kind, 'message')
  assert.equal(timeline[0].turnState, undefined)
  assert.equal(timeline[0].duration, undefined)
})

test('tools and reasoning previews do not end the expanded reasoning for a turn', () => {
  let timeline = [{ kind: 'message', role: 'user', text: '查找资料' }]
  timeline = appendReasoning(timeline, '先查资料')
  timeline = updateTool(pauseReasoning(timeline), 'tool.start', { tool_id: 'search-1', name: 'search_files' })
  timeline = updateTool(pauseReasoning(timeline), 'tool.complete', { tool_id: 'search-1', name: 'search_files' })
  assert.deepEqual(timeline.filter(item => item.kind === 'reasoning').map(item => [item.streaming, item.expanded]), [[false, true]])
  timeline = appendReasoning(timeline, '再核对结果')
  timeline = appendReasoning(timeline, '再核对结果', true)
  assert.deepEqual(timeline.filter(item => item.kind === 'reasoning').map(item => [item.text, item.streaming, item.expanded]), [
    ['先查资料', false, true], ['再核对结果', false, true],
  ])

  timeline = finishReasoning(timeline)
  assert.deepEqual(timeline.filter(item => item.kind === 'reasoning').map(item => [item.streaming, item.expanded]), [
    [false, false], [false, false],
  ])
})
