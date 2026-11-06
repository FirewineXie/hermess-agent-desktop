import assert from 'node:assert/strict'
import test from 'node:test'
import { composeLearnSkillCommand } from '../src/features/profiles/learnSkillModel.ts'

test('learn skill entry preserves the locked Dashboard command composition', () => {
  assert.equal(composeLearnSkillCommand({}), '')
  assert.equal(composeLearnSkillCommand({ directory: ' C:\\sdk ', url: ' https://docs.example.com ', notes: 'first line\nsecond line' }),
    '/learn local source: C:\\sdk; URL: https://docs.example.com; first line second line')
})

test('learn skill entry accepts each source independently', () => {
  assert.equal(composeLearnSkillCommand({ directory: '/tmp/project' }), '/learn local source: /tmp/project')
  assert.equal(composeLearnSkillCommand({ url: 'https://example.com' }), '/learn URL: https://example.com')
  assert.equal(composeLearnSkillCommand({ notes: 'what we just did' }), '/learn what we just did')
})
