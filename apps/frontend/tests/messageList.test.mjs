import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { appendMessage, appendReasoning, finishTurn, historyTimeline, pauseReasoning, updateTool } from '../src/features/chat/timeline.ts'
import { appendCompletedAssistant, consumeAssistantSegment } from '../src/features/chat/assistantSegments.ts'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
after(() => server.close())
const { default: MessageList } = await server.ssrLoadModule('/src/features/chat/components/MessageList.tsx')

function renderMessages(messages, extra = {}) {
  return renderToStaticMarkup(React.createElement(MessageList, {
    messages, assistant: '', turnBusy: false, language: 'zh-CN', t: key => key, ...extra,
  }))
}

function assertOrder(html, texts) {
  let previous = -1
  for (const text of texts) {
    const position = html.indexOf(text)
    assert.ok(position > previous, `${text} must appear after ${texts[texts.indexOf(text) - 1] || 'the start'}`)
    previous = position
  }
}

test('live segments, tool updates and a following turn keep their original positions', () => {
  let messages = appendMessage([], 'user', '第一轮问题', 1000)
  messages = appendReasoning(messages, '第一轮思考')
  const current = { current: '先读取配置' }
  consumeAssistantSegment({ kind: 'message.delta', payload: { text: null } }, current, () => {}, update => { messages = update(messages) })
  messages = updateTool(pauseReasoning(messages), 'tool.start', { tool_id: 'read', name: 'read_config', args: { path: 'config.yaml' } })
  messages = appendMessage(messages, 'assistant', '接着搜索调用')
  messages = updateTool(messages, 'tool.complete', { tool_id: 'read', name: 'read_config', summary: '读取完成' })
  messages = updateTool(messages, 'tool.start', { tool_id: 'search', name: 'search_callers', args: { query: 'config' } })
  messages = updateTool(messages, 'tool.complete', { tool_id: 'search', name: 'search_callers', result: { error: '搜索失败' } })
  messages = finishTurn(appendCompletedAssistant(messages, '第一轮结论'), 3, 'completed')
  messages = appendMessage(messages, 'user', '第二轮问题', 5000)
  messages = appendReasoning(messages, '第二轮思考')
  messages = updateTool(pauseReasoning(messages), 'tool.start', { tool_id: 'verify', name: 'verify_config' })
  const html = renderMessages(messages, { assistant: '第二轮生成中', turnBusy: true })
  assertOrder(html, ['第一轮问题', '第一轮思考', '先读取配置', 'read_config', '接着搜索调用', 'search_callers', '第一轮结论', '第二轮问题', '第二轮思考', 'verify_config', '第二轮生成中'])
  assert.equal((html.match(/read_config/g) || []).length, 1)
  assert.equal((html.match(/复制回复/g) || []).length, 1)
  assert.ok(html.includes('搜索失败'))
  assert.equal((html.match(/<details class="tool-step">/g) || []).length, 2)
  assert.ok(!html.includes('<details class="tool-step" open'))
})

test('restored history keeps reasoning, text and tools in order across turns', () => {
  const messages = historyTimeline([
    { role: 'user', text: '历史第一问', timestamp: 10 },
    { role: 'assistant', text: '历史说明甲', reasoning: '历史思考甲', timestamp: 11 },
    { role: 'tool', tool_call_id: 'a', tool_name: 'history_tool_a' },
    { role: 'assistant', text: '历史说明乙', reasoning: '历史思考乙', timestamp: 12 },
    { role: 'tool', tool_call_id: 'b', tool_name: 'history_tool_b' },
    { role: 'assistant', text: '历史最终回答', timestamp: 13 },
    { role: 'user', text: '历史第二问', timestamp: 20 },
    { role: 'tool', tool_call_id: 'c', tool_name: 'history_tool_c' },
    { role: 'assistant', text: '第二问答案', timestamp: 21 },
  ])
  const html = renderMessages(messages)
  assertOrder(html, ['历史第一问', '历史思考甲', '历史说明甲', 'history_tool_a', '历史思考乙', '历史说明乙', 'history_tool_b', '历史最终回答', '历史第二问', 'history_tool_c', '第二问答案'])
  assert.equal((html.match(/复制回复/g) || []).length, 2)
  assert.ok(!html.includes('class="reasoning-block" open'))
})

test('housekeeping tools after a reused final answer stay after that answer', () => {
  let messages = [
    { kind: 'message', role: 'user', text: '保存结论', turnState: 'completed' },
    { kind: 'message', role: 'assistant', text: '已有结论' },
  ]
  messages = updateTool(messages, 'tool.complete', { tool_id: 'save', name: 'save_memory', summary: '保存完成' })
  messages = appendCompletedAssistant(messages, '已有结论', { response_reused: true })
  const html = renderMessages(messages)
  assertOrder(html, ['保存结论', '已有结论', '复制回复', 'save_memory'])
  assert.equal((html.match(/已有结论/g) || []).length, 1)
})

test('only the completed final answer has a copy action below its content', () => {
  const html = renderMessages([
    { kind: 'message', role: 'user', text: '问题', turnState: 'completed' },
    { kind: 'message', role: 'assistant', text: '中间说明' },
    { kind: 'tools', steps: [{ id: 'one', name: 'read_file', state: 'finished' }] },
    { kind: 'message', role: 'assistant', text: '最终回答' },
  ])
  assert.equal((html.match(/复制回复/g) || []).length, 1)
  assert.ok(html.indexOf('最终回答') < html.indexOf('assistant-message-actions'))
})

test('running messages and streaming text have no reply copy action', () => {
  const html = renderMessages([
    { kind: 'message', role: 'user', text: '问题', startedAt: 1000 },
    { kind: 'message', role: 'assistant', text: '中间说明' },
  ], { assistant: '正在生成', turnBusy: true })
  assert.ok(html.includes('中间说明'))
  assert.ok(html.includes('正在生成'))
  assert.ok(!html.includes('assistant-message-actions'))
})

test('finished history stays copyable while a new turn is running', () => {
  const html = renderMessages([
    { kind: 'message', role: 'user', text: '历史问题' },
    { kind: 'message', role: 'assistant', text: '历史回答' },
    { kind: 'message', role: 'user', text: '新问题', startedAt: 1000 },
  ], { assistant: '新回答', turnBusy: true })
  assert.equal((html.match(/复制回复/g) || []).length, 1)
  assert.ok(html.indexOf('历史回答') < html.indexOf('assistant-message-actions'))
  assert.ok(html.indexOf('assistant-message-actions') < html.indexOf('新问题'))
})

test('failed, interrupted and empty answers have no reply copy action', () => {
  for (const turnState of ['failed', 'interrupted', 'completed']) {
    const html = renderMessages([
      { kind: 'message', role: 'user', text: '问题', turnState },
      { kind: 'message', role: 'assistant', text: turnState === 'completed' ? '  ' : '未完成的回答' },
    ])
    assert.ok(!html.includes('assistant-message-actions'))
  }
})

test('tools and reasoning stay interleaved in their original order while running', () => {
  const html = renderToStaticMarkup(React.createElement(MessageList, {
    messages: [
      { kind: 'message', role: 'user', text: '查找资料', startedAt: 1000 },
      { kind: 'reasoning', text: '第一段思考', streaming: false, expanded: false },
      { kind: 'tools', steps: [{ id: 'tool-1', name: 'browser_exec', state: 'finished' }] },
      { kind: 'reasoning', text: '第二段思考', streaming: true, expanded: true },
      { kind: 'tools', steps: [{ id: 'tool-2', name: 'vision_analyze', state: 'running' }] },
    ],
    assistant: '', turnBusy: true, language: 'zh-CN', t: key => key,
  }))

  assert.equal((html.match(/class="reasoning-block"/g) || []).length, 2)
  assert.equal((html.match(/class="tool-activity"/g) || []).length, 2)
  assert.ok(html.indexOf('第一段思考') < html.indexOf('browser_exec'))
  assert.ok(html.indexOf('browser_exec') < html.indexOf('第二段思考'))
  assert.ok(html.indexOf('第一段思考') < html.indexOf('第二段思考'))
  assert.ok(html.indexOf('第二段思考') < html.indexOf('vision_analyze'))
  assert.ok(html.indexOf('browser_exec') < html.indexOf('vision_analyze'))
  assert.ok(html.includes('class="reasoning-block" open'))
  assert.ok(!html.includes('turn-activity'))
  assert.equal((html.match(/正在执行/g) || []).length, 1)
})

test('completed reasoning is collapsed below the tool list and above the final answer', () => {
  const html = renderToStaticMarkup(React.createElement(MessageList, {
    messages: [
      { kind: 'message', role: 'user', text: '历史问题', duration: 4, turnState: 'completed' },
      { kind: 'tools', steps: [{ id: 'tool-1', name: 'browser_exec', state: 'recorded' }] },
      { kind: 'reasoning', text: '历史思考', streaming: false, expanded: false },
      { kind: 'message', role: 'assistant', text: '最终回答' },
    ],
    assistant: '', turnBusy: false, language: 'zh-CN', t: key => key,
  }))

  assert.ok(html.indexOf('browser_exec') < html.indexOf('历史思考'))
  assert.ok(html.indexOf('历史思考') < html.indexOf('最终回答'))
  assert.ok(html.includes('<div class="tool-activity"'))
  assert.ok(html.includes('<details class="reasoning-block"'))
  assert.ok(!html.includes('class="reasoning-block" open'))
})

test('reasoning remains expanded while tools run and before assistant text appears', () => {
  const html = renderToStaticMarkup(React.createElement(MessageList, {
    messages: [
      { kind: 'message', role: 'user', text: '处理任务', startedAt: 1000 },
      { kind: 'reasoning', text: '检查文件', streaming: false, expanded: true },
      { kind: 'tools', steps: [{ id: 'tool-1', name: 'read_file', state: 'running' }] },
    ],
    assistant: '', turnBusy: true, language: 'zh-CN', t: key => key,
  }))
  assert.ok(html.includes('class="reasoning-block" open'))
  assert.ok(html.includes('思考过程'))
})
