import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
after(() => server.close())
const { describeError } = await server.ssrLoadModule('/src/app/desktopErrors.ts')

test('superseded session refusal explains read-only history and how to continue in both languages', () => {
  const failure = { kind: 'desktop_failure', code: 'session_superseded', category: 'validation' }
  const zh = describeError(failure, 'zh-CN')
  assert.ok(zh.includes('只读'))
  assert.ok(zh.includes('新建聊天'))
  assert.ok(zh.includes('输入已保留'))
  const en = describeError(failure, 'en-US')
  assert.ok(en.includes('read-only'))
  assert.ok(en.includes('new chat'))
})

test('other and malformed errors keep the generic message without exposing raw details', () => {
  for (const failure of ['private gateway details', { kind: 'desktop_failure', code: 'session_superseded', category: 'runtime' }]) {
    const message = describeError(failure, 'zh-CN')
    assert.ok(message.includes('操作未完成'))
    assert.ok(!message.includes('private gateway details'))
    assert.ok(!message.includes('只读'))
  }
})
