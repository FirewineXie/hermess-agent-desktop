import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('runtime progress presents real bytes, connection and installation phases, and terminal states', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { default: Progress } = await server.ssrLoadModule('/src/features/programming/ProgrammingRuntimeProgress.tsx')
    const render = (patch, language = 'zh-CN') => renderToStaticMarkup(React.createElement(Progress, {
      runtime: { tag: 'test', version: 'test', supported: true, state: 'downloading', downloaded: 25 * 1024 * 1024, total: 100 * 1024 * 1024, ...patch }, language,
    }))
    const downloading = render({})
    assert.match(downloading, /25%/)
    assert.match(downloading, /25\.0 MB \/ 100\.0 MB/)
    assert.match(downloading, /<progress[^>]+value="26214400"/)
    const connecting = render({ downloaded: 0, total: 0 })
    assert.match(connecting, /正在连接下载源/)
    assert.doesNotMatch(connecting, /value=|NaN|Infinity|\d+%/)
    const installing = render({ state: 'installing', downloaded: 100 * 1024 * 1024 })
    assert.match(installing, /下载完成，正在校验并安装/)
    assert.doesNotMatch(installing, /value=|100%/)
    for (const state of ['missing', 'failed', 'installed']) assert.equal(render({ state }), '')
    assert.match(render({ downloaded: 0 }), /0%/)
    assert.match(render({ downloaded: 100 * 1024 * 1024 }), /100%/)
    assert.match(render({}, 'en-US'), /Downloading runtime/)
    assert.match(render({ state: 'installing' }, 'en-US'), /Verifying and installing/)
  } finally {
    await server.close()
  }
})
