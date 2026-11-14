import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
after(() => server.close())
const { default: KanbanPinnedBoards } = await server.ssrLoadModule('/src/features/personal-tasks/KanbanPinnedBoards.tsx')

test('pinned shortcuts restore per storage root, retain order and omit unavailable boards', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => key.endsWith(':workspace-one') ? '["engineering","missing","engineering","research",1]' : '[]',
  } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  })
  const render = storagePath => renderToStaticMarkup(React.createElement(KanbanPinnedBoards, {
    storagePath, current: 'research', boards: [{ slug: 'research', name: 'Research' }, { slug: 'engineering', name: 'Engineering' }],
    onSelect: () => {}, onError: () => {},
  }))
  const html = render('workspace-one')
  assert.match(html, /aria-pressed="false">Engineering<\/button><button type="button" aria-pressed="true">Research/)
  assert.ok(!html.includes('missing'))
  assert.ok(!render('workspace-two').includes('Engineering'))
})
