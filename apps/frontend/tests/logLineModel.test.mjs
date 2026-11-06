import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyLogLine } from '../src/features/logs/logLineModel.ts'

const timestamp = '2026-07-26 13:07:45,228'

test('uses the structured Hermes level token without letting payload text spoof it', () => {
  assert.equal(classifyLogLine(`${timestamp} DEBUG registry: scanned`), 'debug')
  assert.equal(classifyLogLine(`${timestamp} WARNING state: low disk`), 'warning')
  assert.equal(classifyLogLine(`${timestamp} CRITICAL agent: stopped`), 'error')
  assert.equal(classifyLogLine(`${timestamp} INFO gateway: parse_errors=0 ERROR text`), 'info')
})

test('classifies untimestamped continuations with word boundaries', () => {
  assert.equal(classifyLogLine('Traceback (most recent call last):'), 'error')
  assert.equal(classifyLogLine('ERROR: something broke'), 'error')
  assert.equal(classifyLogLine('  WARN low disk'), 'warning')
  assert.equal(classifyLogLine('errors=0 and errors.log rotated'), 'info')
  assert.equal(classifyLogLine('ValueError: payload detail'), 'info')
})
