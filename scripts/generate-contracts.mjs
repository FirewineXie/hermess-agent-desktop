import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const schemaDirectory = resolve(root, 'packages/contracts/schema')
const outputDirectory = resolve(root, 'packages/contracts/src/generated')
const schemas = readdirSync(schemaDirectory).filter(name => name.endsWith('.schema.json')).sort()
const schemaByFile = new Map(schemas.map(name => [name, JSON.parse(readFileSync(resolve(schemaDirectory, name), 'utf8'))]))

function renderType(rule, level, references) {
  if (Array.isArray(rule.type)) {
    return rule.type.map(type => type === 'null' ? 'null' : renderType({ ...rule, type }, level, references)).join(' | ')
  }
  if (rule.$ref) {
    const target = schemaByFile.get(rule.$ref)
    if (!target?.title || !/^[a-z-]+\.schema\.json$/.test(rule.$ref)) throw new Error(`Unknown schema reference: ${rule.$ref}`)
    references.set(target.title, rule.$ref.replace(/\.schema\.json$/, ''))
    return target.title
  }
  if (rule.enum) return rule.enum.map(value => JSON.stringify(value)).join(' | ')
  if (rule.type === 'array') return `Array<${renderType(rule.items, level, references)}>`
  if (rule.type === 'object') {
    const fields = Object.entries(rule.properties || {})
    if (!fields.length && rule.additionalProperties === true) return 'Record<string, unknown>'
    if (rule.additionalProperties !== false && rule.additionalProperties !== true) throw new Error('Object schema must define additionalProperties')
    const required = new Set(rule.required || [])
    const lines = fields.map(([name, child]) => {
      if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name)) throw new Error(`Unsupported field name: ${name}`)
      return `${' '.repeat(level + 2)}${name}${required.has(name) ? '' : '?'}: ${renderType(child, level + 2, references)}`
    })
    const objectType = `{\n${lines.join('\n')}\n${' '.repeat(level)}}`
    return rule.additionalProperties === true ? `${objectType} & Record<string, unknown>` : objectType
  }
  if (rule.type === 'integer' || rule.type === 'number') return 'number'
  if (rule.type === 'string' || rule.type === 'boolean') return rule.type
  throw new Error(`Unsupported schema rule: ${JSON.stringify(rule)}`)
}

for (const file of schemas) {
  const schema = schemaByFile.get(file)
  if (!schema.title || schema.type !== 'object') throw new Error(`Invalid schema: ${file}`)
  const references = new Map()
  const declaration = renderType(schema, 0, references)
  const imports = [...references].filter(([name]) => name !== schema.title)
    .map(([name, target]) => `import type { ${name} } from './${target}'\n`).join('')
  const source = `// Generated from schema/${file}. Run pnpm generate:contracts.\n${imports}export type ${schema.title} = ${declaration}\n`
  const output = resolve(outputDirectory, `${basename(file, '.schema.json')}.ts`)
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== source) throw new Error(`Generated contract differs from ${file}; run pnpm generate:contracts`)
  } else {
    writeFileSync(output, source, 'utf8')
  }
}
console.log(process.argv.includes('--check') ? 'Generated contracts match schemas' : 'Generated contracts updated')
