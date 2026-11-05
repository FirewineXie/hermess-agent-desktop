import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' })
after(() => server.close())
const { paletteItems, searchPalette } = await server.ssrLoadModule('/src/features/command-palette/model.ts')

const input = {
  language: 'zh-CN', connected: true, diagnosticsUnlocked: false, selectedProfile: 'default',
  sessions: [{ id: 'session-a', title: '报告分析', preview: '本周数据' }],
  otherProfileSessions: { research: [{ id: 'session-b', title: '报告分析', preview: '竞品数据' }] },
  profileNames: { default: '默认', research: '研究员' }, dashboardPlugins: [],
}

test('search finds pages, settings, actions and same-name sessions in their own profiles', () => {
  const items = paletteItems(input)
  assert.deepEqual(searchPalette(items, '会话管理')[0].target, { kind: 'setting', page: 'sessions' })
  assert.deepEqual(searchPalette(items, '工具与能力')[0].target, { kind: 'setting', page: 'local-tools' })
  assert.equal(searchPalette(items, '主模型')[0].target.page, 'main')
  assert.equal(searchPalette(items, '新建聊天')[0].target.id, 'new-chat')
  assert.deepEqual(searchPalette(items, '报告分析').map(item => item.target).sort((a, b) => a.profile.localeCompare(b.profile)), [
    { kind: 'session', profile: 'default', id: 'session-a' },
    { kind: 'session', profile: 'research', id: 'session-b' },
  ])
  assert.equal(searchPalette(items, '竞品数据')[0].target.profile, 'research')
})

test('offline and hidden destinations are excluded, while settings and pages remain searchable', () => {
  const items = paletteItems({ ...input, connected: false })
  assert.equal(searchPalette(items, '报告分析').length, 0)
  assert.equal(searchPalette(items, '刷新会话').length, 0)
  assert.equal(searchPalette(items, '开发者诊断').length, 0)
  assert.equal(searchPalette(items, '提供商')[0].target.page, 'providers')
  assert.equal(searchPalette(items, '文件管理')[0].target.view, 'files')
})

test('visible plugin pages are searchable and hidden or override plugins are excluded', () => {
  const plugin = name => ({ name, label: name, description: 'sample', tab: { path: `/${name}`, hidden: false, override: null } })
  const items = paletteItems({ ...input, dashboardPlugins: [plugin('achievements'), { ...plugin('hidden'), tab: { path: '/hidden', hidden: true } }] })
  assert.deepEqual(searchPalette(items, 'achievements')[0].target, { kind: 'plugin', name: 'achievements' })
  assert.equal(searchPalette(items, 'hidden').length, 0)
})
