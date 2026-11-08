import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('Code shows directories without an open chat and preserves the composer, permissions and restored sessions', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { default: Chat } = await server.ssrLoadModule('/src/features/programming/ProgrammingChat.tsx')
    const noop = () => {}
    const controller = {
      coding: {}, nativeFiles: {}, catalog: null, selectedModelId: '', selectModel: noop,
      session: null, sessions: [], projects: [], cwd: '/fixture', draftVisible: true, draft: '', images: [], files: [], busy: false, error: '',
      permissions: 'request', permissionProfiles: [], permissionLoading: true, permissionError: '',
      effort: 'medium', setEffort: noop, permissionRuntimeMissing: false,
      retryPermissions: noop, setPermissions: noop,
    }
    const render = changes => renderToStaticMarkup(React.createElement(Chat, { language: 'zh-CN', controller: { ...controller, ...changes } }))
    const loading = render({})
    assert.match(loading, /读取模型…/)
    assert.doesNotMatch(loading, /请先配置模型/)
    assert.match(loading, /读取权限…/)
    assert.match(render({ catalog: { providers: [] } }), /请先配置模型/)
    const configured = render({
      catalog: { effort: 'medium', providers: [{ id: 'provider', name: 'Fixture', models: [{ id: 'model', name: 'Configured model' }] }] },
      selectedModelId: 'model', permissions: 'full', permissionLoading: false,
      permissionProfiles: [{ id: 'request', allowed: false }, { id: 'full', allowed: true }],
    })
    assert.match(configured, /Configured model/)
    assert.doesNotMatch(configured, /请先配置模型|读取模型/)
    assert.match(configured, /aria-label="编程权限"[^>]*aria-haspopup="menu"/)
    assert.match(configured, /完全访问/)
    assert.match(configured, /aria-label="思考强度"[^>]*aria-haspopup="menu"/)
    assert.match(configured, /思考 · 中/)
    assert.doesNotMatch(configured, /<select|<option/)
    const failed = render({ permissionLoading: false, permissionError: 'Fixture failure' })
    assert.match(failed, /权限不可用/)
    assert.doesNotMatch(failed, /重试权限<\/button>/)
    assert.match(render({ permissionLoading: false, permissionRuntimeMissing: true }), /安装运行时/)
    const running = render({ session: { status: 'running', model: 'Fixture', messages: [] }, effort: 'high' })
    assert.match(running, /aria-label="思考强度"[^>]*disabled=""/)
    assert.match(running, /思考 · 高/)
    for (const cwd of ['C:\\Work\\Website', '/work/website']) {
      const directories = render({
        draftVisible: false, cwd: '',
        projects: [{ id: 'website', name: '我的网站', cwd, legacy_cwds: [] }],
        sessions: [{ id: 'history', project_id: 'website', cwd, title: '历史会话' }],
      })
      assert.match(directories, /选择工作目录/)
      assert.match(directories, /我的网站/)
      assert.ok(directories.includes(cwd))
      assert.doesNotMatch(directories, /历史会话|composer-submit|读取权限/)
    }
    const empty = render({ draftVisible: false, cwd: '', sessions: [] })
    assert.match(empty, /还没有工作目录/)
    assert.match(empty, /添加工作目录/)
    assert.match(render({ draftVisible: false, error: 'DIRECTORY_LOAD_FAILED' }), /role="alert">DIRECTORY_LOAD_FAILED/)
    const restored = render({ draftVisible: false, session: { status: 'completed', cwd: '/work/website', messages: [], output: 'RESTORED_CODE_SESSION' } })
    assert.match(restored, /RESTORED_CODE_SESSION/)
    assert.doesNotMatch(restored, /选择工作目录/)
  } finally { await server.close() }
})
