import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const schemaPath = resolve(root, 'packages/contracts/schema/backend-info.schema.json')
const outputPath = resolve(root, 'packages/contracts/src/generated/backend-info.ts')
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
if (schema.type !== 'object' || !schema.title || !schema.properties) throw new Error('Invalid BackendInfo schema')

const required = new Set(schema.required || [])
const fields = Object.entries(schema.properties).map(([name, rule]) => {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name)) throw new Error(`Unsupported field name: ${name}`)
  const type = rule.type === 'integer' || rule.type === 'number' ? 'number' : rule.type === 'string' ? 'string' : rule.type === 'boolean' ? 'boolean' : null
  if (!type) throw new Error(`Unsupported schema type for ${name}`)
  return `  ${name}${required.has(name) ? '' : '?'}: ${type}`
})
const source = `// Generated from schema/backend-info.schema.json. Run pnpm generate:contracts.\nexport type ${schema.title} = {\n${fields.join('\n')}\n}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== source) throw new Error('Generated contract differs from schema; run pnpm generate:contracts')
  console.log('Generated contract matches schema')
} else {
  writeFileSync(outputPath, source, 'utf8')
  console.log('Generated contract updated')
}
