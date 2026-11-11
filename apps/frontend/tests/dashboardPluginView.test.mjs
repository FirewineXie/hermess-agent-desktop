import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

// Host module captures browser transports at import time; SSR never invokes them.
globalThis.window = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch }
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
after(() => { delete globalThis.window; return server.close() })
const { default: View } = await server.ssrLoadModule('/src/features/dashboard-plugins/DashboardPluginView.tsx')
const manifest = { name: 'starter', label: 'Starter', tab: { path: '/starter' } }
const profiles = { selected: 'beta', profiles: [{ name: 'default' }, { name: 'beta', display_name: '研发助理' }] }
function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(View, {
    plugin: 'starter', profiles, connected: true, busy: false,
    plugins: { manifests: [manifest], components: new Map([['starter', () => React.createElement('p', null, 'Beta plugin content')]]), loading: false, error: '' },
    onSelectProfile: async () => {}, onBack() {}, onManage() {}, ...overrides,
  }))
}
test('page identifies its current Profile and offers every existing Profile', () => {
  const html = render()
  assert.match(html, /<select[^>]*aria-label="插件所属 Profile"/)
  assert.match(html, /value="beta" selected=""/)
  assert.match(html, /研发助理 \(beta\)/)
  assert.match(html, /Beta plugin content/)
})
test('loading and discovery failure never imply the plugin is not installed', () => {
  for (const state of [{ loading: true, error: '' }, { loading: false, error: '读取失败' }]) {
    const html = render({ plugins: { manifests: [], components: new Map(), ...state } })
    assert.doesNotMatch(html, /未安装|安装或管理插件|Beta plugin content/)
    assert.match(html, state.loading ? /正在读取/ : /读取失败.*重试/)
  }
})
test('an unavailable plugin retains the picker and exposes management; offline disables the picker', () => {
  const html = render({ plugins: { manifests: [], components: new Map(), loading: false, error: '' } })
  assert.match(html, /未安装、未启用或已隐藏/)
  assert.match(html, /安装或管理插件/)
  assert.match(html, /插件所属 Profile/)
  const offline = render({ connected: false })
  assert.match(offline, /<select[^>]*disabled=""/)
  assert.match(offline, /请先连接 Gateway/)
  assert.doesNotMatch(offline, /Beta plugin content|安装或管理插件/)
})
