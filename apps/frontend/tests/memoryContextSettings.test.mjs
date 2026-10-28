import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configValuesEqual,
  isMemoryContextField,
  isSensitiveConfigField,
  memoryFieldGroups,
  parseConfigFieldDraft,
  sensitiveMemoryFieldCount,
  unsupportedMemoryFieldCount,
} from '../src/features/agent-settings/memoryContextModel.ts'

const schema = {
  category_order: [],
  fields: {
    'memory.custom_future_field': { type: 'string', description: 'Future field' },
    'memory.provider': { type: 'select', options: ['none', 'honcho'] },
    'memory.memory_enabled': { type: 'boolean' },
    'memory.user_profile_enabled': { type: 'boolean' },
    'memory.memory_char_limit': { type: 'number' },
    'context.engine': { type: 'select', options: ['compressor', 'custom'] },
    'compression.enabled': { type: 'boolean' },
    'compression.rule': { type: 'object' },
    'auxiliary.compression.provider': { type: 'string' },
    'auxiliary.compression.api_key': { type: 'string' },
    'compression.future_type': { type: 'duration' },
    'approvals.mode': { type: 'select' },
  },
}

test('memory and context ownership is limited to the four runtime prefixes', () => {
  assert.equal(isMemoryContextField('memory.memory_enabled'), true)
  assert.equal(isMemoryContextField('context.engine'), true)
  assert.equal(isMemoryContextField('compression.enabled'), true)
  assert.equal(isMemoryContextField('auxiliary.compression.timeout'), true)
  assert.equal(isMemoryContextField('auxiliary.title_generation.timeout'), false)
  assert.equal(isMemoryContextField('approvals.mode'), false)
})

test('persistent memory keeps priority fields first and includes new schema fields', () => {
  const fields = memoryFieldGroups(schema, 'memory-persistent')[0].fields.map(([key]) => key)
  assert.deepEqual(fields, [
    'memory.memory_enabled',
    'memory.user_profile_enabled',
    'memory.memory_char_limit',
    'memory.provider',
    'memory.custom_future_field',
  ])
})

test('context groups own context, compression, and compression auxiliary fields', () => {
  const groups = memoryFieldGroups(schema, 'memory-context')
  assert.deepEqual(groups.map(group => [group.id, group.fields.map(([key]) => key)]), [
    ['context', ['context.engine']],
    ['compression', ['compression.enabled', 'compression.rule']],
    ['compression-model', ['auxiliary.compression.provider']],
  ])
})

test('sensitive and unsupported schema fields are not turned into generic editors', () => {
  assert.equal(isSensitiveConfigField('auxiliary.compression.api_key'), true)
  assert.equal(sensitiveMemoryFieldCount(schema, 'memory-context'), 1)
  assert.equal(unsupportedMemoryFieldCount(schema, 'memory-context'), 1)
})

test('schema field drafts are converted without guessing values', () => {
  assert.equal(parseConfigFieldDraft('42', { type: 'number' }), 42)
  assert.equal(parseConfigFieldDraft('false', { type: 'boolean' }), false)
  assert.deepEqual(parseConfigFieldDraft('[1,2]', { type: 'list' }), [1, 2])
  assert.deepEqual(parseConfigFieldDraft('{"enabled":true}', { type: 'object' }), { enabled: true })
  assert.throws(() => parseConfigFieldDraft('', { type: 'number' }), /invalid-number/)
  assert.throws(() => parseConfigFieldDraft('{}', { type: 'list' }), /invalid-array/)
})

test('readback comparison ignores object key order but preserves array order', () => {
  assert.equal(configValuesEqual({ b: 2, a: { value: true } }, { a: { value: true }, b: 2 }), true)
  assert.equal(configValuesEqual([1, 2], [2, 1]), false)
  assert.equal(configValuesEqual(1, '1'), false)
})
