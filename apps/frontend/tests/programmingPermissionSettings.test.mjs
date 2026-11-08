import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { settingsPages } from '../src/features/settings/model.ts'

test('permission menu opens the global programming permission tab; missing runtime and retry retain their destinations', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { ProgrammingPermissions } = await server.ssrLoadModule('/src/features/programming/ProgrammingComposerControls.tsx')
    const destinations = []
    let retried = 0
    const controller = {
      permissionProfiles: [{ id: 'custom', allowed: true }], permissions: 'custom',
      retryPermissions: () => { retried++ },
      coding: { openPermissionConfig: () => { throw new Error('Must navigate rather than opening a file') } },
    }
    const render = changes => ProgrammingPermissions({ controller: { ...controller, ...changes }, language: 'zh-CN', onOpenSettings: target => destinations.push(target) })
    render({}).props.footer.props.onClick()
    assert.deepEqual(destinations, ['permissions'])
    const page = settingsPages.find(page => page.id === 'programming-permissions')
    assert.equal(page.category, 'programming')
    assert.equal(page.zh, '自定义权限')
    render({ permissionRuntimeMissing: true }).props.footer.props.onClick()
    assert.deepEqual(destinations, ['permissions', undefined])
    render({ permissionError: 'Read failed' }).props.footer.props.onClick()
    assert.equal(retried, 1)
  } finally { await server.close() }
})
