import assert from 'node:assert/strict'
import { test } from 'node:test'
import { historyTimeline } from '../src/features/chat/timeline.ts'
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
