import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('approval displays only offered decisions and distinguishes temporary grants from persistent rules', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { default: Approval } = await server.ssrLoadModule('/src/features/programming/ProgrammingApproval.tsx')
    const render = (options, busy = false, source) => renderToStaticMarkup(React.createElement(Approval, {
      approval: { id: 'a', command: 'git status', description: '查看变更', cwd: '/project', options, source }, language: 'zh-CN', busy, onChoose: () => {},
    }))
    const restricted = render([{ id: 'a', kind: 'once', detail: '' }, { id: 'c', kind: 'cancel', detail: '' }])
    assert.match(restricted, /允许一次/)
    assert.match(restricted, /拒绝并停止本轮/)
    assert.doesNotMatch(restricted, /始终允许|本轮允许同类操作|拒绝并继续/)
    const html = render([{ id: 's', kind: 'session', detail: '' }, { id: 'p', kind: 'command_rule', detail: '["git","status"]' }], true)
    assert.match(html, /下一轮可能再次询问/)
    assert.match(html, /始终允许此前缀/)
    assert.match(html, /当前编程会话的独立运行目录/)
    assert.match(html, /&quot;git&quot;,&quot;status&quot;/)
    assert.equal((html.match(/disabled=""/g) || []).length, 2)
    const computer = render([{ id: 'once', kind: 'once', detail: '' }], false, 'computer')
    assert.match(computer, /电脑操作需要单独审批，仅允许本次调用/)
    assert.doesNotMatch(computer, /来自当前 Codex 请求/)
  } finally { await server.close() }
})
