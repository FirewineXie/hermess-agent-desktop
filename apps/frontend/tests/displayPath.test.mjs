import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayPath } from '../src/shared/displayPath.ts'

test('Windows local and UNC paths use ordinary spelling', () => {
  assert.equal(displayPath('\\\\?\\C:\\Hermess Data\\file.txt'), 'C:\\Hermess Data\\file.txt')
  assert.equal(displayPath('\\\\?\\UNC\\host\\share\\file.txt'), '\\\\host\\share\\file.txt')
  assert.equal(displayPath('C:/Hermess Data/file.txt'), 'C:\\Hermess Data\\file.txt')
  assert.equal(displayPath('/Users/example/file.txt'), '/Users/example/file.txt')
})
