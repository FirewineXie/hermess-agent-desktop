import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
test('frontend and native builtin forwarding policies stay aligned', () => {
  const frontend = fs.readFileSync(new URL('../src/features/chat/model.ts', import.meta.url), 'utf8')
  const native = fs.readFileSync(new URL('../../desktop/src-tauri/src/runtime/composer_policy.rs', import.meta.url), 'utf8')
  const block = frontend.split('DESKTOP_GATEWAY_COMMANDS = new Set([')[1].split('])')[0]
  const local = new Set(['new', 'sessions', 'model', 'history', 'resume', 'stop', 'config', 'tools', 'cron', 'plugins'])
  const frontendNames = [...block.matchAll(/'([^']+)'/g)].map(match => match[1]).filter(name => !local.has(name)).sort()
  const nativeNames = [...new Set([...native.matchAll(/"\/([^"]+)"/g)].map(match => match[1]))].sort()
  assert.deepEqual(frontendNames, nativeNames)
})
