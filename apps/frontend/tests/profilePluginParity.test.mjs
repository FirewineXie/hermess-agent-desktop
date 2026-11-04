import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('custom plugin installation stays in Profile management with explicit install choices', () => {
  const profile = read('apps/frontend/src/features/profiles/ProfileHermesPlugins.tsx')
  const market = read('apps/frontend/src/features/extensions/HermesPlugins.tsx')
  assert.match(profile, /'hermesPlugins\.install'/)
  assert.match(profile, /identifier, force: installForce, enable: installEnable/)
  assert.match(profile, /owner\/repo\/subdirectory/)
  assert.doesNotMatch(market, /identifier\s*:/)
  assert.match(market, /left disabled by default/)
})

test('context engine selector uses dynamic Hub providers instead of the static config schema', () => {
  const settings = read('apps/frontend/src/features/agent-settings/MemoryContextSettings.tsx')
  const selector = read('apps/frontend/src/features/agent-settings/ContextEngineSettings.tsx')
  const locked = read('upstream/hermes-agent/web/src/pages/PluginsPage.tsx')
  assert.match(settings, /key !== 'context\.engine'/)
  assert.match(selector, /'hermesPlugins\.contextEngines'/)
  assert.match(selector, /'hermesPlugins\.contextEngine\.save'/)
  assert.match(locked, /providers\.context_options/)
  assert.match(locked, /savePluginProviders\(\{ context_engine: contextSel \}\)/)
})
