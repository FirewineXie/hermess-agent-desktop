import assert from 'node:assert/strict'
import test from 'node:test'
import { displayedTools, externalKeyUrl } from '../src/features/env-keys/envKeyPresentation.ts'

test('key links only expose browser-safe HTTP URLs', () => {
  assert.equal(externalKeyUrl('https://example.com/keys'), 'https://example.com/keys')
  assert.equal(externalKeyUrl('javascript:alert(1)'), null)
  assert.equal(externalKeyUrl('not a url'), null)
  assert.equal(externalKeyUrl(null), null)
})

test('tool badges are trimmed, non-empty and unique', () => {
  assert.deepEqual(displayedTools([' web ', '', 'browser', 'web']), ['web', 'browser'])
})
