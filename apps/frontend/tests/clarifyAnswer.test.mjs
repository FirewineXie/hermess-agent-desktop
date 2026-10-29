import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composeClarifyAnswer } from '../src/features/chat/clarifyAnswer.ts'

test('a selected recommendation keeps the optional explanation in one answer', () => {
  assert.equal(
    composeClarifyAnswer('先不定，听你建议 (Recommended)', '每周只能写一篇'),
    '先不定，听你建议\n补充说明：每周只能写一篇',
  )
})

test('typed text without a selection is a custom answer; blank remains skipped', () => {
  assert.equal(composeClarifyAnswer(null, '  想先做工具教程  '), '想先做工具教程')
  assert.equal(composeClarifyAnswer(null, '   '), null)
})

test('multi-select adds free text as another answer', () => {
  assert.deepEqual(
    JSON.parse(composeClarifyAnswer('["长尾内容 (Recommended)","固定栏目"]', '预算有限', true)),
    ['长尾内容', '固定栏目', '预算有限'],
  )
})
