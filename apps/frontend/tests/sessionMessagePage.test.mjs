import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import fs from 'node:fs/promises'
import vm from 'node:vm'

async function loadModule() {
  const source = await fs.readFile(new URL('../src/features/session-management/sessionMessagePage.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, { module, exports: module.exports }, { filename: 'sessionMessagePage.ts' })
  return module.exports
}

test('marks only a full latest-page at the locked receiver limit as potentially truncated', async () => {
  const { LOCKED_SESSION_MESSAGE_LIMIT, reachedSessionMessageLimit } = await loadModule()
  assert.equal(LOCKED_SESSION_MESSAGE_LIMIT, 500)
  assert.equal(reachedSessionMessageLimit({ limit: 500, offset: 0, order: 'latest', returned: 500 }), true)
  assert.equal(reachedSessionMessageLimit({ limit: 500, offset: 0, order: 'latest', returned: 499 }), false)
  assert.equal(reachedSessionMessageLimit({ limit: 500, offset: 0, order: 'oldest', returned: 500 }), false)
  assert.equal(reachedSessionMessageLimit(null), false)
})
