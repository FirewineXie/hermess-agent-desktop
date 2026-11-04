import assert from 'node:assert/strict'
import test from 'node:test'
import { assistantCopyLabel, copyAssistantText } from '../src/features/chat/assistantCopy.ts'

test('assistant reply copy reports success and preserves the full response', async () => {
  let copied = ''
  assert.equal(await copyAssistantText('完整回复\n第二行', async value => { copied = value }), 'copied')
  assert.equal(copied, '完整回复\n第二行')
  assert.equal(assistantCopyLabel('zh-CN', 'copied'), '已复制')
})

test('assistant reply copy exposes empty and clipboard failures', async () => {
  assert.equal(await copyAssistantText('  ', async () => {}), 'failed')
  assert.equal(await copyAssistantText('reply', async () => { throw new Error('denied') }), 'failed')
  assert.equal(assistantCopyLabel('en-US', 'failed'), 'Copy failed')
})
