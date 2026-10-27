import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendModelIds } from '../src/features/models/model.ts'

test('model discovery appends new IDs without changing local order or existing IDs', () => {
  const local = ['manually-added', 'ark-code-latest']
  assert.deepEqual(appendModelIds(local, ['ark-code-latest', 'new-model', 'new-model', ' bad id ']),
    ['manually-added', 'ark-code-latest', 'new-model'])
  assert.deepEqual(local, ['manually-added', 'ark-code-latest'])
})
