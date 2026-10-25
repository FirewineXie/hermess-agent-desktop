import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
after(() => server.close())
const { default: MessageList } = await server.ssrLoadModule('/src/features/chat/components/MessageList.tsx')

test('multiple tool calls show one running state and active reasoning stays expanded', () => {
  const html = renderToStaticMarkup(React.createElement(MessageList, {
    messages: [
      { kind: 'message', role: 'user', text: '查找资料', startedAt: 1000 },
      { kind: 'reasoning', text: '第一段思考', streaming: false },
      { kind: 'tools', steps: [{ id: 'tool-1', name: 'browser_exec', state: 'finished' }] },
      { kind: 'reasoning', text: '第二段思考', streaming: true },
      { kind: 'tools', steps: [{ id: 'tool-2', name: 'vision_analyze', state: 'running' }] },
    ],
    assistant: '', turnBusy: true, language: 'zh-CN', t: key => key,
  }))

  assert.equal((html.match(/class="reasoning-block"/g) || []).length, 1)
  assert.equal((html.match(/class="turn-activity"/g) || []).length, 1)
  assert.ok(html.indexOf('第一段思考') < html.indexOf('第二段思考'))
  assert.ok(html.indexOf('vision_analyze') < html.indexOf('第一段思考'))
  assert.ok(html.indexOf('browser_exec') < html.indexOf('vision_analyze'))
  assert.ok(html.includes('class="reasoning-block" open'))
  assert.ok(!html.includes('class="turn-activity" open'))
  assert.ok(html.includes('<details class="turn-activity"'))
  const summary = html.match(/<summary class="turn-duration"[^>]*>(.*?)<\/summary>/)?.[1] || ''
  assert.equal((summary.match(/正在执行/g) || []).length, 1)
})

test('completed reasoning is collapsed below the tool list and above the final answer', () => {
  const html = renderToStaticMarkup(React.createElement(MessageList, {
    messages: [
      { kind: 'message', role: 'user', text: '历史问题', duration: 4, turnState: 'completed' },
      { kind: 'tools', steps: [{ id: 'tool-1', name: 'browser_exec', state: 'recorded' }] },
      { kind: 'reasoning', text: '历史思考', streaming: false },
      { kind: 'message', role: 'assistant', text: '最终回答' },
    ],
    assistant: '', turnBusy: false, language: 'zh-CN', t: key => key,
  }))

  assert.ok(html.indexOf('browser_exec') < html.indexOf('历史思考'))
  assert.ok(html.indexOf('历史思考') < html.indexOf('最终回答'))
  assert.ok(html.includes('<details class="turn-activity"'))
  assert.ok(!html.includes('class="turn-activity" open'))
  assert.ok(html.includes('<details class="reasoning-block"'))
  assert.ok(!html.includes('class="reasoning-block" open'))
})
