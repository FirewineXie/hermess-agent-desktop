import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('storage panel explains deferred activation and exposes pending and blocked recovery states', async () => {
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { StorageLocationPanel } = await server.ssrLoadModule('/src/features/runtime/StorageLocationSettings.tsx')
    const callbacks = Object.fromEntries(['onChoose', 'onSave', 'onCancel', 'onRetry'].map(name => [name, () => {}]))
    const settings = { currentPath: 'C:\\old', pendingPath: null, enabled: true, blocked: false, error: null }
    const render = (overrides = {}) => renderToStaticMarkup(React.createElement(StorageLocationPanel, { settings, draft: '', busy: false, message: '', ...callbacks, ...overrides }))
    const draft = render({ draft: 'D:\\new' })
    assert.match(draft, /保存，下次启动生效/)
    assert.match(draft, /不会移动或删除原位置的数据/)
    assert.match(draft, /已有本产品数据的目录会使用其中的数据，不合并/)
    assert.doesNotMatch(draft, /取消更改|重试启用/)
    const pending = render({ settings: { ...settings, pendingPath: 'D:\\new' } })
    assert.match(pending, /待生效位置/)
    assert.match(pending, /取消更改/)
    assert.match(pending, /从托盘退出应用/)
    assert.doesNotMatch(pending, /重试启用/)
    const blocked = render({ settings: { ...settings, pendingPath: 'D:\\new', blocked: true, error: 'in_use' } })
    assert.match(blocked, /数据功能尚未启动/)
    assert.match(blocked, /重试启用/)
    assert.match(blocked, /其他本产品实例/)
    assert.match(render({ settings: { ...settings, error: 'same_path' } }), /已在使用此位置/)
    const busy = render({ busy: true, draft: 'D:\\new' })
    assert.equal((busy.match(/<button[^>]*disabled=""/g) || []).length, 2)
    assert.match(render({ settings: null }), /重新读取/)
    const running = render({ gatewayRunning: true, draft: 'D:\\new' })
    assert.match(running, /请先在上方运行时控制中停止本地 Gateway，再更改存储位置/)
    assert.equal((running.match(/<button[^>]*disabled=""/g) || []).length, 2)
    const stopped = render({ gatewayRunning: false, draft: 'D:\\new' })
    assert.doesNotMatch(stopped, /<button[^>]*disabled=""/)
    assert.match(render({ settings: { ...settings, error: 'gateway_running' } }), /停止本地 Gateway/)
  } finally { await server.close() }
})
