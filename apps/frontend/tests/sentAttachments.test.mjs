import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sentAttachments } from '../src/features/chat/sentAttachments.ts'
import { appendMessage, finishTurn } from '../src/features/chat/timeline.ts'

test('a sent turn keeps its image preview and file list after the turn finishes', () => {
  const attachments = sentAttachments([
    { kind: 'image', name: 'shot.png', bytes: 123, source_path: 'clipboard', content_base64: 'secret-image-bytes', image_preview: 'data:image/jpeg;base64,preview' },
    { kind: 'file', name: 'notes.txt', bytes: 45, source_path: 'C:\\notes.txt', ref_text: '@file:notes.txt' },
  ])
  const messages = finishTurn(appendMessage([], 'user', '请分析这两份材料', 1000, attachments), 2, 'completed')
  assert.deepEqual(messages[0].attachments, attachments)
  assert.equal(messages[0].text, '请分析这两份材料')
  assert.equal(JSON.stringify(messages).includes('secret-image-bytes'), false)
  assert.equal(JSON.stringify(messages).includes('@file:notes.txt'), false)
})
