import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const schema = read('packages/contracts/schema/backend-info.schema.json')
const fixture = read('packages/contracts/fixtures/backend-info.json')

assert.equal(schema.type, 'object')
assert.deepEqual(Object.keys(fixture).sort(), [...schema.required].sort())
for (const [name, rule] of Object.entries(schema.properties)) {
  const value = fixture[name]
  if (rule.type === 'integer') assert.ok(Number.isInteger(value), `${name} must be an integer`)
  if (rule.type === 'string') assert.equal(typeof value, 'string', `${name} must be a string`)
  if (rule.minimum !== undefined) assert.ok(value >= rule.minimum, `${name} below minimum`)
  if (rule.maximum !== undefined) assert.ok(value <= rule.maximum, `${name} above maximum`)
  if (rule.minLength !== undefined) assert.ok(value.length >= rule.minLength, `${name} too short`)
}
console.log('Shared contract fixture verified')
