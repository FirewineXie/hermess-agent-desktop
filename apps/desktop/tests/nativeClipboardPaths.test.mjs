import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

test('native file adapter reads copied Finder paths through the desktop command', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { crypto: globalThis.crypto }
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { tauriDesktopApi } = await server.ssrLoadModule('/src/adapter/tauriDesktopApi.ts')
    const paths = ['/Users/test/Project Folder']
    mockIPC((command, args) => {
      assert.equal(command, 'read_clipboard_file_paths')
      assert.deepEqual(args, {})
      return paths
    })
    assert.deepEqual(await tauriDesktopApi.nativeFiles.clipboardPaths(), paths)
  } finally {
    await server.close()
    clearMocks()
    globalThis.window = originalWindow
  }
})
