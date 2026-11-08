import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

test('permission settings adapter sends form fields and revision and returns persisted settings or host failures', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { crypto: globalThis.crypto }
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { tauriDesktopApi } = await server.ssrLoadModule('/src/adapter/tauriDesktopApi.ts')
    const draft = { revision: 'fixture-revision', default_permissions: 'hermess-readonly', approval_policy: 'on-request', approvals_reviewer: 'auto_review' }
    const settings = { ...draft, profiles: ['hermess', 'hermess-readonly'] }
    mockIPC((command, args) => {
      assert.equal(command, 'coding_session_request')
      assert.deepEqual(args.request, { action: 'permission_settings' })
      return settings
    })
    assert.deepEqual(await tauriDesktopApi.coding.permissionSettings(), settings)
    mockIPC((command, args) => {
      assert.equal(command, 'coding_session_request')
      assert.deepEqual(args.request, { action: 'save_permission_settings', draft })
      return { ...settings, revision: 'saved-revision' }
    })
    assert.equal((await tauriDesktopApi.coding.savePermissionSettings(draft)).revision, 'saved-revision')
    const conflict = { kind: 'desktop_failure', code: 'conflict', category: 'validation' }
    mockIPC(() => { throw conflict })
    await assert.rejects(tauriDesktopApi.coding.savePermissionSettings(draft), cause => cause.code === 'conflict')
  } finally {
    await server.close(); clearMocks(); globalThis.window = originalWindow
  }
})
