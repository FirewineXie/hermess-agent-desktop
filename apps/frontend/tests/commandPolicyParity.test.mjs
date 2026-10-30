import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
test('frontend and native builtin forwarding policies stay aligned', () => {
  const frontend = fs.readFileSync(new URL('../src/features/chat/model.ts', import.meta.url), 'utf8')
  const native = fs.readFileSync(new URL('../../desktop/src-tauri/src/runtime/composer_policy.rs', import.meta.url), 'utf8')
  const block = frontend.split('DESKTOP_GATEWAY_COMMANDS = new Set([')[1].split('])')[0]
  const nativeBlock = native.split('let builtin = matches!(')[1].split(');')[0]
  const local = new Set(['new', 'sessions', 'model', 'history', 'resume', 'retry', 'compress', 'steer', 'btw', 'stop', 'config', 'tools', 'toolsets', 'cron', 'plugins', 'save'])
  const frontendNames = [...block.matchAll(/'([^']+)'/g)].map(match => match[1]).filter(name => !local.has(name)).sort()
  const nativeNames = [...new Set([...nativeBlock.matchAll(/"\/([^"]+)"/g)].map(match => match[1]))].sort()
  assert.deepEqual(frontendNames, nativeNames)
  const frontendDenied = frontend.split('DESKTOP_DENIED_COMMANDS = new Set([')[1].split('])')[0]
  const nativeDenied = native.split('if matches!(')[1].split(') {')[0]
  const frontendDeniedNames = [...frontendDenied.matchAll(/'\/([^']+)'/g)].map(match => match[1]).sort()
  const nativeDeniedNames = [...nativeDenied.matchAll(/"\/([^"]+)"/g)].map(match => match[1]).sort()
  assert.deepEqual(frontendDeniedNames, nativeDeniedNames)
  assert.equal(frontendDeniedNames.some(name => frontendNames.includes(name)), false)
})
