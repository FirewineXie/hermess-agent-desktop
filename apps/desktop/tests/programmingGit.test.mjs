import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

test('coding Git adapter routes the selected directory and branch without a shell command', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { crypto: globalThis.crypto }
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { tauriDesktopApi } = await server.ssrLoadModule('/src/adapter/tauriDesktopApi.ts')
    const git = { state: 'repository', branch: 'main', detached: false, branches: ['main', 'feature/example'] }
    mockIPC((command, args) => {
      assert.equal(command, 'coding_session_request')
      assert.deepEqual(args.request, { action: 'branch', cwd: 'C:\\project space' })
      return git
    })
    assert.deepEqual(await tauriDesktopApi.coding.branch('C:\\project space'), git)
    mockIPC((command, args) => {
      assert.equal(command, 'coding_session_request')
      assert.deepEqual(args.request, { action: 'switch_branch', cwd: 'C:\\project space', branch: 'feature/example' })
      return { ...git, branch: 'feature/example' }
    })
    assert.equal((await tauriDesktopApi.coding.switchBranch('C:\\project space', 'feature/example')).branch, 'feature/example')
  } finally {
    await server.close()
    clearMocks()
    globalThis.window = originalWindow
  }
})
