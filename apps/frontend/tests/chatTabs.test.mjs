import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { chatTabKey, chatTabStatus, chatTabsToClose, registerChatTab, removeChatTabs } from '../src/features/chat/chatTabsState.ts'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
after(() => server.close())
const { default: ChatTabs } = await server.ssrLoadModule('/src/features/chat/ChatTabs.tsx')

test('one window has at most one blank chat across profiles without losing saved tabs', () => {
  let tabs = registerChatTab([], { profile: 'a', id: '' })
  tabs = registerChatTab(tabs, { profile: 'a', id: 'saved' })
  tabs = registerChatTab(tabs, { profile: 'b', id: '' })
  assert.deepEqual(tabs, [{ profile: 'a', id: 'saved' }, { profile: 'b', id: '' }])
  assert.equal(registerChatTab(tabs, { profile: 'b', id: '' }), tabs)
  tabs = registerChatTab(tabs, { profile: 'b', id: 'saved' })
  assert.equal(tabs.length, 3)
  assert.notEqual(chatTabKey(tabs[0]), chatTabKey(tabs[2]))
})

test('batch close modes preserve active, running, pending and unknown sessions as specified', () => {
  const states = ['idle', 'running', 'approval', 'suggestion', 'completed', 'failed', 'disconnected']
  const tabs = states.map(id => ({ profile: 'a', id }))
  tabs.push({ profile: 'a', id: '' })
  const active = chatTabKey(tabs[1])
  const status = tab => tab.id || 'new'
  assert.deepEqual(chatTabsToClose(tabs, active, 'idle', status).map(tab => tab.id), ['idle', 'completed', 'failed'])
  assert.equal(chatTabsToClose(tabs, active, 'others', status).length, 7)
  assert.ok(!chatTabsToClose(tabs, active, 'others', status).some(tab => tab.id === 'running'))
  assert.equal(chatTabsToClose(tabs, active, 'all', status).length, 8)
  assert.deepEqual(removeChatTabs(tabs, tabs, { profile: 'a', id: '' }), [{ profile: 'a', id: '' }])
  assert.equal(tabs.length, 8)
})

test('batch close with an active-session fallback replaces another profile blank', () => {
  const tabs = [{ profile: 'a', id: 'one' }, { profile: 'b', id: '' }, { profile: 'b', id: 'two' }]
  assert.deepEqual(removeChatTabs(tabs, [tabs[0]], { profile: 'a', id: '' }), [
    { profile: 'b', id: 'two' }, { profile: 'a', id: '' },
  ])
})

test('tab status uses connection, pending requests and actual activity without inventing completion', () => {
  const saved = { profile: 'a', id: 'one' }, blank = { profile: 'a', id: '' }
  assert.equal(chatTabStatus(blank, true, undefined, true, false, false), 'new')
  assert.equal(chatTabStatus(blank, true, undefined, true, true, false), 'running')
  assert.equal(chatTabStatus(saved, true, undefined, false, false, false), 'idle')
  assert.equal(chatTabStatus(saved, true, undefined, false, false, true), 'running')
  assert.equal(chatTabStatus(saved, true, 'approval', true, true, true), 'approval')
  assert.equal(chatTabStatus(saved, true, 'suggestion', true, true, true), 'suggestion')
  assert.equal(chatTabStatus(saved, true, 'completed', false, false, false), 'completed')
  assert.equal(chatTabStatus(saved, true, 'failed', false, false, false), 'failed')
  assert.equal(chatTabStatus(saved, false, 'running', true, true, true), 'disconnected')
})

test('tabs show text statuses, keep window actions and expose batch-close choices', () => {
  const html = renderToStaticMarkup(React.createElement(ChatTabs, {
    tabs: [{ profile: 'a', id: 'one' }, { profile: 'a', id: '' }], activeKey: 'a\u0000one', disabled: false,
    language: 'zh-CN', title: tab => tab.id ? '长会话标题' : '新聊天', status: tab => tab.id ? 'approval' : 'new',
    onSelect() {}, onClose() {}, onOpenWindow() {}, onNew() {}, onCloseMany() {},
  }))
  assert.ok(html.includes('待审批'))
  assert.ok(html.includes('未开始'))
  assert.ok(html.includes('在新窗口打开: 长会话标题'))
  assert.ok(!html.includes('在新窗口打开: 新聊天'))
  assert.ok(html.includes('关闭其他标签'))
  assert.ok(html.includes('关闭空闲标签'))
  assert.ok(html.includes('关闭全部标签'))
  assert.ok(html.includes('只关闭标签，保留会话和运行任务。'))
})

test('the only blank tab cannot be closed and a busy navigation disables batch actions', () => {
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(ChatTabs, {
      tabs: [{ profile: 'a', id: '' }], activeKey: 'a\u0000', disabled,
      language: 'zh-CN', title: () => '新聊天', status: () => 'new',
      onSelect() {}, onClose() {}, onOpenWindow() {}, onNew() {}, onCloseMany() {},
    }))
    assert.match(html, /aria-label="关闭标签: 新聊天" disabled=""/)
    for (const label of ['关闭其他标签', '关闭空闲标签', '关闭全部标签']) {
      assert.ok(html.includes(`disabled="">${label}</button>`))
    }
  }
})
