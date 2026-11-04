import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import fs from 'node:fs/promises'
import vm from 'node:vm'

async function loadModule() {
  const source = await fs.readFile(new URL('../src/features/session-management/sessionSourceFilter.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, { module, exports: module.exports, Set }, { filename: 'sessionSourceFilter.ts' })
  return module.exports
}

test('category defaults match the locked Dashboard source scopes', async () => {
  const { buildSessionSourceFilter } = await loadModule()
  assert.deepEqual(
    JSON.parse(JSON.stringify(buildSessionSourceFilter('chats', null, ['cli', 'cron']))),
    { excludeSources: ['cron', 'tool', 'oneshot', 'api_server', 'acp', 'hermes_flow', 'vulcan_delegate', 'webhook'] },
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(buildSessionSourceFilter('automation', null, ['cli', 'cron']))),
    { excludeSources: ['cli'] },
  )
})

test('explicit source selections preserve empty, single, and multiple meanings', async () => {
  const { buildSessionSourceFilter } = await loadModule()
  assert.deepEqual(JSON.parse(JSON.stringify(buildSessionSourceFilter('all', [], ['cli', 'cron']))), { excludeSources: ['cli', 'cron'] })
  assert.deepEqual(JSON.parse(JSON.stringify(buildSessionSourceFilter('all', [], []))), { source: '__hermes_dashboard_no_matching_source__' })
  assert.deepEqual(JSON.parse(JSON.stringify(buildSessionSourceFilter('all', ['cli'], ['cli', 'cron']))), { source: 'cli' })
  assert.deepEqual(JSON.parse(JSON.stringify(buildSessionSourceFilter('all', ['cli', 'slack'], ['cli', 'cron', 'slack']))), { excludeSources: ['cron'] })
})

test('category membership separates automation from chat sources', async () => {
  const { sourcesForCategory } = await loadModule()
  assert.deepEqual(Array.from(sourcesForCategory(['cli', 'cron', 'telegram', 'webhook'], 'chats')), ['cli', 'telegram'])
  assert.deepEqual(Array.from(sourcesForCategory(['cli', 'cron', 'telegram', 'webhook'], 'automation')), ['cron', 'webhook'])
})
