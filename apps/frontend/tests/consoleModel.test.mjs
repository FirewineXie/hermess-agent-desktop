import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConsoleFrame } from '../src/features/runtime/consoleModel.ts'

test('accepts locked console frames and bounded optional strings', () => {
  assert.deepEqual(parseConsoleFrame('{"type":"ready","profile":"writer","prompt":"hermes> "}'), {
    type: 'ready', profile: 'writer', prompt: 'hermes> ',
  })
  assert.deepEqual(parseConsoleFrame('{"type":"complete","status":"cancelled"}'), {
    type: 'complete', status: 'cancelled',
  })
})

test('rejects malformed, unknown, and oversized frames', () => {
  assert.equal(parseConsoleFrame('not-json'), null)
  assert.equal(parseConsoleFrame('{"type":"shell"}'), null)
  assert.equal(parseConsoleFrame(' '.repeat(256 * 1024 + 1)), null)
})
