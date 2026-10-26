import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/desktop/dist')
const assets = []

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (entry.isFile()) assets.push(path)
  }
}

await collect(dist)
const scripts = assets.filter(path => extname(path) === '.js')
if (scripts.length === 0) throw new Error('Desktop build contains no JavaScript assets')
if (assets.some(path => extname(path) === '.map')) {
  throw new Error('Desktop build must not contain source maps')
}
for (const path of scripts) {
  if (/sourceMappingURL\s*=/.test(await readFile(path, 'utf8'))) {
    throw new Error(`Desktop asset contains a source map reference: ${path}`)
  }
}

console.log(`Checked ${scripts.length} desktop JavaScript assets; no source maps found`)
