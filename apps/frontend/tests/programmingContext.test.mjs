import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('context usage distinguishes missing telemetry, real zero, latest request and capacity', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { ProgrammingUsage } = await server.ssrLoadModule('/src/features/programming/ProgrammingContext.tsx')
    const render = (context, language = 'zh-CN') => renderToStaticMarkup(React.createElement(ProgrammingUsage, { language, controller: { session: context ? { context } : null } }))
    const unknown = render(null)
    assert.match(unknown, /等待运行时返回用量/)
    assert.match(unknown, /尚未返回上下文容量/)
    assert.doesNotMatch(unknown, /\d+%|<progress/)
    const usedOnly = render({ used_tokens: 42 })
    assert.match(usedOnly, /42 tokens/)
    assert.doesNotMatch(usedOnly, /\d+%|<progress/)
    const zero = render({ used_tokens: 0, context_window: 200000 })
    assert.match(zero, /0%/)
    assert.doesNotMatch(zero, /等待运行时返回用量/)
    const used = render({ used_tokens: 42000, context_window: 200000 })
    assert.match(used, /21%/)
    assert.match(used, /42,000 tokens/)
    assert.match(used, /200,000 tokens/)
    assert.match(render({ used_tokens: 120, context_window: 100 }), /<progress[^>]+value="100"/)
    assert.match(render(null, 'en-US'), /Waiting for runtime usage/)
  } finally { await server.close() }
})
