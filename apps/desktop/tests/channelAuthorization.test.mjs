import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

test('production channel adapter delivers authorization before save finishes and preserves save errors', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { crypto: globalThis.crypto }
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { tauriDesktopApi } = await server.ssrLoadModule('/src/adapter/tauriDesktopApi.ts')
    const scope = { kind: 'profile', profile: 'default' }
    for (const fails of [false, true]) {
      let finishSave
      let authorized = false
      let settled = false
      mockIPC((command, args) => {
        assert.equal(command, 'channel_qr_poll')
        assert.equal(args.profile, scope.profile)
        assert.equal(args.id, 'operation')
        assert.equal(args.access, 'open')
        window.__TAURI_INTERNALS__.runCallback(args.onAuthorized.id, { index: 0, message: null })
        return new Promise((resolve, reject) => {
          finishSave = () => {
            window.__TAURI_INTERNALS__.runCallback(args.onAuthorized.id, { index: 1, end: true })
            if (fails) reject({ kind: 'desktop_failure', code: 'operation_failed', category: 'operation' })
            else resolve({ status: 'connected', restart_required: true })
          }
        })
      })
      const result = tauriDesktopApi.channels.poll(scope, 'operation', 'open', () => { authorized = true })
      result.then(() => { settled = true }, () => { settled = true })
      await Promise.resolve()
      assert.equal(authorized, true)
      assert.equal(settled, false)
      finishSave()
      if (fails) await assert.rejects(result, { code: 'operation_failed' })
      else assert.deepEqual(await result, { status: 'connected', restart_required: true })
      assert.equal(window.__TAURI_INTERNALS__.callbacks.size, 0)
    }
  } finally {
    await server.close()
    clearMocks()
    globalThis.window = originalWindow
  }
})
