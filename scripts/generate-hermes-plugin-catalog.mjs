import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const root = fileURLToPath(new URL('../', import.meta.url))
const upstream = join(root, 'upstream', 'hermes-agent')
const directory = join(upstream, 'plugin-catalog')
const output = join(root, 'apps', 'frontend', 'src', 'features', 'extensions', 'hermesPluginCatalog.generated.json')
const lock = JSON.parse(readFileSync(join(root, 'runtime', 'upstream.lock.json'), 'utf8'))
const actual = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== lock.commit) throw new Error(`Hermes checkout ${actual} does not match lock ${lock.commit}`)
const removed = YAML.parse(readFileSync(join(directory, 'removed.yaml'), 'utf8')).removed || []
if (!Array.isArray(removed) || removed.some(item => !item || typeof item.name !== 'string')) throw new Error('Invalid removed.yaml')
const names = new Set()
const entries = readdirSync(directory).filter(name => name.endsWith('.yaml') && name !== 'removed.yaml').sort().map(file => {
  const item = YAML.parse(readFileSync(join(directory, file), 'utf8'))
  if (!item || !/^[a-z0-9_-]{1,64}$/.test(item.name) || !/^https:\/\//.test(item.repo) || !/^[0-9a-f]{40}$/i.test(item.sha)
      || !['official', 'verified', 'community'].includes(item.tier || 'community')
      || !['desktop', 'memory', 'platform', 'web', 'tools', 'voice', 'automation', 'models', 'general'].includes(item.category || 'desktop')
      || names.has(item.name)) {
    throw new Error(`Invalid or duplicate Hermes plugin entry: ${file}`)
  }
  names.add(item.name)
  return {
    name: item.name, title: item.title || '', description: item.description || '', repo: item.repo,
    sha: item.sha.toLowerCase(), version: item.version || '', maintainer: item.maintainer || '',
    category: item.category || 'desktop', tier: item.tier || 'community', platforms: item.platforms || [],
    requires_hermes: item.requires_hermes || '', docs_url: item.docs_url || '', capabilities: item.capabilities || {},
  }
})
const snapshot = JSON.stringify({ sourceCommit: lock.commit, entries, removed }, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== snapshot) throw new Error('Hermes plugin catalog snapshot is stale')
} else {
  writeFileSync(output, snapshot, 'utf8')
}
console.log(`Hermes plugin catalog: ${entries.length} entries, ${removed.length} removed; ${actual.slice(0, 8)}`)
