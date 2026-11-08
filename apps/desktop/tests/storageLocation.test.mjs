import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

test('production storage adapter preserves tagged requests, receiver errors and frozen current location', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { crypto: globalThis.crypto }
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { tauriDesktopApi } = await server.ssrLoadModule('/src/adapter/tauriDesktopApi.ts')
    const currentPath = 'C:\\旧 数据'
    for (const request of [{ action: 'get' }, { action: 'save', path: 'D:\\新 数据' }, { action: 'cancel' }, { action: 'retry' }]) {
      const response = { currentPath, pendingPath: request.action === 'save' ? request.path : null, enabled: true, blocked: false, error: null }
      mockIPC((command, args) => {
        assert.equal(command, 'storage_location_request')
        assert.deepEqual(args, { request })
        return response
      })
      assert.deepEqual(await tauriDesktopApi.runtime.storageLocation(request), response)
    }
    mockIPC(() => { throw { kind: 'desktop_failure', code: 'invalid_input', category: 'validation' } })
    await assert.rejects(tauriDesktopApi.runtime.storageLocation({ action: 'get' }), { code: 'invalid_input' })
  } finally {
    await server.close()
    clearMocks()
    globalThis.window = originalWindow
  }
})
