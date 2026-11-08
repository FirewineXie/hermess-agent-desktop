import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { settingsPages } from '../src/features/settings/model.ts'

test('programming configuration exposes separate tabs and MCP inventory is read-only', async () => {
  for (const id of ['programming-config-file', 'programming-mcp', 'programming-skills', 'programming-permissions', 'programming-instructions', 'programming-context']) {
    assert.equal(settingsPages.find(page => page.id === id)?.category, 'programming')
  }
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { default: Mcp } = await server.ssrLoadModule('/src/features/programming/ProgrammingMcpSettings.tsx')
    const controller = { draft: { mcp_servers: [{ id: 'fixture', transport: 'stdio', enabled: true }, { id: 'disabled', transport: 'http', enabled: false }] }, busy: false }
    const html = renderToStaticMarkup(React.createElement(Mcp, { controller, zh: true }))
    assert.match(html, /fixture/); assert.match(html, /disabled/)
    assert.match(html, /已启用/); assert.match(html, /已禁用/)
    assert.match(html, /只展示/)
    assert.doesNotMatch(html, /<input|<textarea|<select|添加服务器|移除服务器|保存配置/)
  } finally { await server.close() }
})
