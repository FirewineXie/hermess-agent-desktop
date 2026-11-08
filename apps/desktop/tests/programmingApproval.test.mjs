import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

test('coding approval adapter forwards the offered option identity and preserves failures', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { crypto: globalThis.crypto }
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { tauriDesktopApi } = await server.ssrLoadModule('/src/adapter/tauriDesktopApi.ts')
    mockIPC((command, args) => {
      assert.equal(command, 'coding_session_request')
      assert.deepEqual(args.request, { action: 'approve', id: 'chat', request_id: 'request', option_id: 'option-2' })
      return null
    })
    await tauriDesktopApi.coding.approve('chat', 'request', 'option-2')
    mockIPC(() => Promise.reject({ kind: 'desktop_failure', code: 'conflict', category: 'validation' }))
    await assert.rejects(tauriDesktopApi.coding.approve('chat', 'expired', 'option-2'), { code: 'conflict' })
  } finally {
    await server.close()
    clearMocks()
    globalThis.window = originalWindow
  }
})
