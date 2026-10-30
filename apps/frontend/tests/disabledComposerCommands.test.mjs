import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

test('commands disabled by the desktop plan stay unavailable even when the catalog lists collisions', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { DESKTOP_DENIED_COMMANDS, commandSupported, commandChoices, composerTrigger, deniedCommandNotice } = await server.ssrLoadModule('/src/features/chat/model.ts')
    const plan = readFileSync(new URL('../../../docs/desktop-slash-commands-plan.md', import.meta.url), 'utf8')
    const denied = [...plan.matchAll(/^\| `(\/[^`]+)` \| ([^|]+) \|/gm)]
      .filter(([, , decision]) => /当前保持禁用|暂不接入|禁止桌面执行|改用界面操作/.test(decision))
      .map(([, name]) => name)
    assert.deepEqual([...DESKTOP_DENIED_COMMANDS].filter(name => name !== '/bg').sort(), [...denied].sort())
    const catalog = {
      pairs: denied.map(name => [name, 'Listed command']),
      skills: Object.fromEntries(denied.map(name => [name, {}])),
      categories: [{ name: 'Plugin commands', pairs: denied.map(name => [name, 'Plugin']) }],
      commands: {}, sub: {},
    }
    for (const name of denied) {
      assert.equal(commandSupported(catalog, name), false)
      assert.deepEqual(commandChoices(catalog, composerTrigger(name, name.length), 'zh-CN'), [])
    }
    assert.equal(commandSupported(catalog, '/bg'), true)
    assert.equal(commandSupported(catalog, '/status'), true)
    assert.match(deniedCommandNotice('/rollback', 'zh-CN'), /文件恢复的安全预览与保护尚未完成/)
    assert.match(deniedCommandNotice('/rollback', 'en-US'), /safe file restore/)
    assert.equal(deniedCommandNotice('/bg', 'zh-CN'), '')
    assert.equal(deniedCommandNotice('/status', 'zh-CN'), '')
  } finally {
    await server.close()
  }
})
