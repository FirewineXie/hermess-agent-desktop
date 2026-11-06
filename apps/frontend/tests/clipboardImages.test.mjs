import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clipboardImages } from '../src/features/chat/clipboardImages.ts'

const image = { name: 'shot.png', type: 'image/png' }
const document = { name: 'notes.txt', type: 'text/plain' }

test('pasted image files are staged once when both clipboard collections contain them', () => {
  const data = {
    files: [image, document],
    items: [{ type: 'image/png', getAsFile: () => image }],
  }
  assert.deepEqual(clipboardImages(data), [image])
})

test('image items work when the clipboard file list is empty', () => {
  const data = { files: [], items: [{ type: 'image/png', getAsFile: () => image }] }
  assert.deepEqual(clipboardImages(data), [image])
})

test('text and non-image files do not become image attachments', () => {
  const data = { files: [document], items: [{ type: 'text/plain', getAsFile: () => document }] }
  assert.deepEqual(clipboardImages(data), [])
})
