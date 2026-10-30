import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendReasoning, finishReasoning, historyTimeline, pauseReasoning, updateTool } from '../src/features/chat/timeline.ts'
import { sessionSourceLabel } from '../src/features/chat/sessionSource.ts'

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
