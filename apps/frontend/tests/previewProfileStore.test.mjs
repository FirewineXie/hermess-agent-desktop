import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPreviewProfileStore } from '../src/preview/profileStore.ts'

test('preview Profile settings are isolated from each other and from their seed', () => {
  const seed = { security: { approval: 'ask' }, endpoints: [{ id: 'one' }] }
  const forProfile = createPreviewProfileStore(seed)
  forProfile('default').security.approval = 'allow'
  forProfile('default').endpoints.push({ id: 'two' })
  assert.deepEqual(forProfile('coding'), seed)
  assert.equal(forProfile('default').security.approval, 'allow')
  assert.deepEqual(seed, { security: { approval: 'ask' }, endpoints: [{ id: 'one' }] })
})
