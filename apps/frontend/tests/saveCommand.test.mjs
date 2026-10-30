import assert from 'node:assert/strict'
import test from 'node:test'
import { executeSaveCommand, parseSaveArgs, saveCommandConflict } from '../src/features/chat/saveCommand.ts'

test('save command accepts format, filename and redaction', () => {
  assert.deepEqual(parseSaveArgs('md'), { format: 'md', filename: undefined, redact: false })
  assert.deepEqual(parseSaveArgs('json backup.json --redact'), { format: 'json', filename: 'backup.json', redact: true })
  assert.deepEqual(parseSaveArgs('html redact'), { format: 'html', filename: undefined, redact: true })
})

test('save command rejects missing format and extra arguments', () => {
  for (const input of ['', 'backup.json', 'md a b', 'md redact foo']) assert.equal(parseSaveArgs(input), null)
})

test('save command leaves the session alone on cancel or invalid input', async () => {
  const scope = { kind: 'session', profile: 'default', sessionId: 'local-1' }
  let calls = 0
  const exportSession = async () => { calls++; return null }
  assert.deepEqual(await executeSaveCommand(exportSession, scope, 'md'), { kind: 'cancelled' })
  assert.deepEqual(await executeSaveCommand(exportSession, scope, 'bad'), { kind: 'usage' })
  assert.deepEqual(await executeSaveCommand(exportSession, null, 'md'), { kind: 'missing' })
  assert.equal(calls, 1)
  assert.equal(saveCommandConflict({ kind: 'desktop_failure', code: 'conflict', category: 'validation' }, 'zh-CN'), '目标文件已存在，请选择新文件名。')
})
