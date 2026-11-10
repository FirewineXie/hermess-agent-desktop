import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const manifest = JSON.parse(await readFile(new URL('dashboard/manifest.json', import.meta.url), 'utf8'))
assert.match(manifest.name, /^[a-z0-9][a-z0-9_-]*$/)
assert.match(manifest.tab.path, /^\/[a-z0-9][a-z0-9_-]*$/)
assert.match(manifest.entry, /^[a-z0-9_-]+\.js$/)

const source = await readFile(new URL(`dashboard/${manifest.entry}`, import.meta.url), 'utf8')
const registrations = []
runInNewContext(source, { window: {
  __HERMES_PLUGIN_SDK__: { React: { createElement() {} }, components: {} },
  __HERMES_PLUGINS__: {
    register(name, component) { registrations.push({ name, slot: null, component }) },
    registerSlot(name, slot, component) { registrations.push({ name, slot, component }) },
  },
} }, { filename: manifest.entry, timeout: 1000 })

assert(registrations.every(({ name, component }) => name === manifest.name && typeof component === 'function'))
assert.equal(registrations.filter(({ slot }) => slot === null).length, 1)
assert.deepEqual(registrations.flatMap(({ slot }) => slot === null ? [] : [slot]), manifest.slots)
console.log(`Validated ${manifest.name}: ${manifest.tab.path}, ${manifest.slots.join(', ')}`)
