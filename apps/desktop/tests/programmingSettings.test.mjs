import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'

test('coding configuration routes file-backed reads, writes, probes, directory and project instructions', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { crypto: globalThis.crypto }
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { tauriDesktopApi } = await server.ssrLoadModule('/src/adapter/tauriDesktopApi.ts')
    let request
    mockIPC((command, args) => { assert.equal(command, 'coding_session_request'); request = args.request; return { revision: 'saved' } })
    await tauriDesktopApi.coding.settings(); assert.deepEqual(request, { action: 'settings' })
    await tauriDesktopApi.coding.configFile(); assert.deepEqual(request, { action: 'config_file' })
    await tauriDesktopApi.coding.saveConfigFile('before', '# comment\nmodel_context_window = 200000\n')
    assert.deepEqual(request, { action: 'save_config_file', revision: 'before', content: '# comment\nmodel_context_window = 200000\n' })
    const draft = { revision: 'before', instructions: { developer_instructions: 'fixture' } }
    await tauriDesktopApi.coding.saveSettings(draft); assert.deepEqual(request, { action: 'save_settings', draft })
    await tauriDesktopApi.coding.settingsProbe('', 'fixture', true); assert.deepEqual(request, { action: 'settings_probe', cwd: '', server: 'fixture', login: true })
    await tauriDesktopApi.coding.openSkillDirectory(); assert.deepEqual(request, { action: 'open_skill_directory' })
    await tauriDesktopApi.coding.saveProjectInstruction('C:\\fixture', 'before', 'new content')
    assert.deepEqual(request, { action: 'project_instruction', cwd: 'C:\\fixture', revision: 'before', content: 'new content' })
    mockIPC(() => { throw { kind: 'desktop_failure', code: 'conflict', category: 'validation' } })
    await assert.rejects(tauriDesktopApi.coding.saveSettings(draft), error => error.code === 'conflict')
    await assert.rejects(tauriDesktopApi.coding.saveConfigFile('before', ''), error => error.code === 'conflict')
  } finally { await server.close(); clearMocks(); globalThis.window = originalWindow }
})
