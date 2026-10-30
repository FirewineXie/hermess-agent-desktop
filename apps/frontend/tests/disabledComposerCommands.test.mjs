import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

test('bg and rollback stay unavailable even when the catalog lists colliding commands', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { commandSupported, commandChoices, composerTrigger } = await server.ssrLoadModule('/src/features/chat/model.ts')
    const catalog = {
      pairs: [['/bg', 'Background'], ['/rollback', 'Rollback']],
      skills: { '/bg': {}, '/rollback': {} },
      categories: [{ name: 'Plugin commands', pairs: [['/bg', 'Plugin'], ['/rollback', 'Plugin']] }],
      commands: {}, sub: {},
    }
    for (const name of ['/bg', '/rollback']) {
      assert.equal(commandSupported(catalog, name), false)
      assert.deepEqual(commandChoices(catalog, composerTrigger(name, name.length), 'zh-CN'), [])
    }
  } finally {
    await server.close()
  }
})
