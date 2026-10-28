import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('preview provider saves and rereads the main model within its Profile', async () => {
  globalThis.window = { location: { search: '' } }
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, preTransformRequests: false, hmr: false } })
  try {
    const { previewDesktopApi } = await server.ssrLoadModule('/src/preview/mockDesktopApi.ts')
    const defaultScope = { profile: 'default' }
    const codingScope = { profile: 'coding' }
    const beforeCoding = await previewDesktopApi.models.savedConfig(codingScope)

    await previewDesktopApi.models.addEndpoint(defaultScope, {
      name: 'Local', baseUrl: 'https://local.example/v1', model: 'local-first',
      apiKey: '', makeDefault: true, discoverModels: false,
    })
    const created = (await previewDesktopApi.models.endpoints(defaultScope)).endpoints.find(row => row.name === 'Local')
    assert.ok(created)
    assert.equal(created.is_current, true)
    assert.deepEqual(await previewDesktopApi.models.savedConfig(defaultScope), {
      provider: created.id, model: 'local-first', base_url: 'https://local.example/v1',
    })
    assert.equal((await previewDesktopApi.models.options(defaultScope, { refresh: false })).providers
      .find(row => row.slug === created.id)?.is_current, true)
    assert.deepEqual(await previewDesktopApi.models.savedConfig(codingScope), beforeCoding)
    assert.equal((await previewDesktopApi.models.endpoints(codingScope)).endpoints.some(row => row.id === created.id), false)

    await previewDesktopApi.models.updateEndpoint(defaultScope, {
      endpointId: created.id, name: 'Local updated', baseUrl: 'https://updated.example/v1',
      model: 'local-next', apiKey: null, makeDefault: true, discoverModels: true,
    })
    assert.deepEqual(await previewDesktopApi.models.savedConfig(defaultScope), {
      provider: created.id, model: 'local-next', base_url: 'https://updated.example/v1',
    })
    await previewDesktopApi.models.deleteEndpoint(defaultScope, created.id)
    assert.equal((await previewDesktopApi.models.savedConfig(defaultScope)).provider, '')
    assert.deepEqual(await previewDesktopApi.models.savedConfig(codingScope), beforeCoding)
  } finally {
    await server.close()
    delete globalThis.window
  }
})
