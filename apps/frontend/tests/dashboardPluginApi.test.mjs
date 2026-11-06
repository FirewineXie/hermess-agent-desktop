import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from '../node_modules/typescript/lib/typescript.js'
import { assertDashboardPluginBodyProfile, createDashboardPluginApi, dashboardPluginApiPath } from '../src/features/dashboard-plugins/dashboardPluginApi.ts'
import { dashboardPluginResponse } from '../src/features/dashboard-plugins/dashboardPluginResponse.ts'

const LOCKED_API_SOURCE = new URL('../../../upstream/hermes-agent/web/src/lib/api.ts', import.meta.url)
const CORE_API_SOURCE = new URL('../src/features/dashboard-plugins/dashboardPluginCoreApi.ts', import.meta.url)
const ADMIN_API_SOURCE = new URL('../src/features/dashboard-plugins/dashboardPluginAdminApi.ts', import.meta.url)
const HOST_API_SOURCE = new URL('../src/features/dashboard-plugins/dashboardPluginApi.ts', import.meta.url)
const UPSTREAM_LOCK = new URL('../../../runtime/upstream.lock.json', import.meta.url)

const PROFILE_BOUND_OVERRIDES = [
  'getCronJobs', 'getCronDeliveryTargets', 'createCronJob', 'updateCronJob', 'pauseCronJob',
  'resumeCronJob', 'triggerCronJob', 'deleteCronJob', 'getAutomationBlueprints',
  'instantiateAutomationBlueprint', 'getSkills', 'toggleSkill', 'getSkillContent', 'createSkill',
  'updateSkillContent', 'getToolsets', 'toggleToolset', 'getToolsetConfig',
  'selectToolsetProvider', 'saveToolsetEnv', 'runToolsetPostSetup', 'installSkillFromHub',
  'uninstallSkillFromHub', 'updateSkillsFromHub', 'searchSkillsHub', 'getSkillHubSources',
]
const DESKTOP_EQUIVALENT_OVERRIDES = [
  'logout', 'startGateway', 'stopGateway', 'restartGateway', 'getGatewayMigratePlan',
  'migrateGatewayToMultiplex', 'checkHermesUpdate', 'updateHermes', 'getPortal',
]

async function objectProperties(url, kind) {
  const source = await readFile(url, 'utf8')
  const file = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const properties = new Map()
  const returnedObjects = []
  const add = object => {
    for (const property of object.properties) {
      if (!property.name) continue
      properties.set(property.name.getText(file), property.getText(file))
    }
  }
  const visit = node => {
    if (kind === 'locked' && ts.isVariableDeclaration(node)
      && node.name.getText(file) === 'api' && ts.isObjectLiteralExpression(node.initializer)) add(node.initializer)
    if (kind === 'return' && ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) returnedObjects.push(node.expression)
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (kind === 'return') add(returnedObjects.sort((left, right) => right.properties.length - left.properties.length)[0])
  return properties
}

const normalizedProperty = value => value.replace(/\s+/g, '')

const create = (calls = [], lifecycle = {
  start: async () => ({ pid: 11 }), stop: async () => ({ pid: 12 }), restart: async () => ({ pid: 13 }),
}, buildHttpUrl = path => `hermess-proxy:${path}`) => createDashboardPluginApi(
  async (path, init = {}) => { calls.push([path, init]); return { ok: true } },
  async (path, init = {}) => { calls.push([path, init]); return { ok: true } },
  async path => `ws-proxy:${path}`,
  'research',
  lifecycle,
  buildHttpUrl,
)

test('dashboard plugin api contains every method exported by the locked Dashboard SDK', async () => {
  const source = await readFile(LOCKED_API_SOURCE, 'utf8')
  const start = source.indexOf('export const api = {')
  const object = source.slice(start, source.indexOf('\n};', start))
  const locked = [...object.matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm)].map(match => match[1])
  const exposed = Object.keys(create())
  assert.deepEqual(locked.filter(name => !exposed.includes(name)), [])
})

test('copied SDK request contracts stay byte-equivalent to the locked Dashboard API', async () => {
  const [locked, core, admin, host] = await Promise.all([
    objectProperties(LOCKED_API_SOURCE, 'locked'),
    objectProperties(CORE_API_SOURCE, 'return'),
    objectProperties(ADMIN_API_SOURCE, 'return'),
    objectProperties(HOST_API_SOURCE, 'return'),
  ])
  const copied = new Map([...core, ...admin])
  assert.equal(locked.size, 172)
  assert.deepEqual([...locked.keys()].filter(name => !copied.has(name)), ['buildWsUrl'])
  for (const [name, source] of copied) {
    assert.equal(normalizedProperty(source), normalizedProperty(locked.get(name)), name)
  }
  assert.deepEqual(
    [...host.keys()].sort(),
    ['buildWsUrl', 'exportSessionUrl', ...PROFILE_BOUND_OVERRIDES, ...DESKTOP_EQUIVALENT_OVERRIDES].sort(),
  )
})

test('desktop equivalents keep the locked SDK response shapes and propagate lifecycle failures', async () => {
  const api = create()
  assert.deepEqual(await api.startGateway(), { name: 'gateway-start', ok: true, pid: 11 })
  assert.deepEqual(await api.stopGateway(), { name: 'gateway-stop', ok: true, pid: 12 })
  assert.deepEqual(await api.restartGateway(), { name: 'gateway-restart', ok: true, pid: 13 })
  assert.deepEqual(await api.getGatewayMigratePlan(), {
    already_multiplexed: true, blockers: [], command: '', eligible: false,
    notices: ['Gateway lifecycle is managed by Hermess Agent Desktop.'], profiles: [],
  })
  assert.deepEqual(await api.migrateGatewayToMultiplex(), {
    name: 'gateway-migrate', ok: true, pid: null, message: 'Gateway is already managed by Hermess Agent Desktop.',
  })
  const update = await api.checkHermesUpdate(true)
  const lockedVersion = JSON.parse(await readFile(UPSTREAM_LOCK, 'utf8')).tag.replace(/^v/, '')
  assert.deepEqual(update, {
    install_method: 'desktop-app', current_version: lockedVersion, behind: null, update_available: false,
    can_apply: false, update_command: '', message: 'Hermes updates are managed by Hermess Agent Desktop.',
  })
  assert.deepEqual(await api.updateHermes(), {
    name: 'hermes-update', ok: false, pid: null, error: 'Hermes updates are managed by Hermess Agent Desktop.',
  })
  assert.deepEqual(await api.getPortal(), {
    logged_in: false, portal_url: null, inference_url: null, provider: '', subscription_url: '', features: [],
  })
  const logout = await api.logout()
  assert.equal(logout instanceof Response, true)
  assert.equal(logout.status, 204)

  const failure = new Error('start failed')
  const failing = create([], { start: async () => { throw failure }, stop: async () => null, restart: async () => null })
  await assert.rejects(failing.startGateway(), error => error === failure)
})

test('session export URLs stay on the owning runtime and body profiles cannot escape it', () => {
  const api = create()
  assert.equal(api.exportSessionUrl('session / 1'), 'hermess-proxy:/api/sessions/session%20%2F%201/export?profile=research')
  assert.throws(() => api.exportSessionUrl('session-1', 'other'), /another Profile/)
  assert.doesNotThrow(() => assertDashboardPluginBodyProfile({ profile: 'research' }, 'research'))
  assert.throws(() => assertDashboardPluginBodyProfile({ profile: 'other' }, 'research'), /another Profile/)
  assert.equal(dashboardPluginApiPath('/api/local-models/status', 'research'), '/api/local-models/status?profile=research')
})

test('raw plugin responses preserve safe download metadata', async () => {
  const response = dashboardPluginResponse({
    status: 206,
    status_text: 'Partial Content',
    content_type: 'application/octet-stream',
    headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="backup.zip"' },
    body_base64: btoa('archive'),
    url: 'http://hermess.local/api/ops/backup/download?archive=backup.zip',
    redirected: true,
  })
  assert.equal(response.status, 206)
  assert.equal(response.statusText, 'Partial Content')
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="backup.zip"')
  assert.equal(response.url, 'http://hermess.local/api/ops/backup/download?archive=backup.zip')
  assert.equal(response.redirected, true)
  assert.equal(await response.text(), 'archive')
})

test('profile-scoped defaults stay on the plugin owner profile', async () => {
  const calls = []
  const api = create(calls)
  await api.getSessions()
  await api.getCronJobs()
  await api.getSkills()
  await api.getToolsets()
  await api.installSkillFromHub('official/browser')
  assert.equal(calls[0][0].includes('profile=research'), true)
  assert.equal(calls[1][0], '/api/cron/jobs?profile=research')
  assert.equal(calls[2][0], '/api/skills?profile=research')
  assert.equal(calls[3][0], '/api/tools/toolsets?profile=research')
  assert.equal(JSON.parse(calls[4][1].body).profile, 'research')
})

test('dashboard plugin api exposes no generic path escape hatch', () => {
  assert.equal('request' in create(), false)
})

test('dashboard plugin loading ignores changing lifecycle object identities', async () => {
  const source = await readFile(new URL('../src/features/dashboard-plugins/DashboardPluginHost.tsx', import.meta.url), 'utf8')
  assert.match(source, /const lifecycleRef = React\.useRef\(lifecycle\)/)
  assert.match(source, /exposeRuntime\(runtime, stableLifecycle\)/)
  assert.doesNotMatch(source, /language, lifecycle, profile/)
})

test('direct fetchJSON paths are owner-bound before reaching native code', () => {
  assert.equal(dashboardPluginApiPath('/api/config', 'research'), '/api/config?profile=research')
  assert.equal(dashboardPluginApiPath('/api/profiles', 'research'), '/api/profiles')
  assert.throws(() => dashboardPluginApiPath('/api/config?profile=other', 'research'), /another Profile/)
  assert.throws(() => dashboardPluginApiPath('https://example.test/api/config', 'research'), /outside/)
})

test('every locked convenience method resolves a concrete route or desktop equivalent', async () => {
  const calls = []
  const api = create(calls)
  const file = new File(['fixture'], 'fixture.txt', { type: 'text/plain' })
  const special = {
    uploadFile: ['fixture', file, true],
    runImportUpload: [file, false],
    getLogs: [{}],
    getSessions: ['research'],
    importSessions: [[{ id: 'session-1' }], 'research'],
    searchSessions: ['fixture', 'research'],
    updateAgentPlugin: ['fixture', {}],
    runDebugShare: [{}],
  }
  const local = new Set(['buildWsUrl', 'exportSessionUrl', 'logout', 'startGateway', 'stopGateway', 'restartGateway', 'getGatewayMigratePlan', 'migrateGatewayToMultiplex', 'checkHermesUpdate', 'updateHermes', 'getPortal'])
  for (const [name, fn] of Object.entries(api)) {
    assert.equal(typeof fn, 'function', name)
    if (local.has(name)) continue
    calls.length = 0
    const args = special[name] || ['fixture', 'fixture', 'fixture', 'fixture']
    await fn(...args)
    assert.ok(calls.length > 0, `${name} did not resolve a request`)
    const [path, init] = calls[0]
    assert.match(path, /^\/api\//, name)
    assert.match(String(init.method || 'GET'), /^(GET|POST|PUT|PATCH|DELETE)$/, name)
  }
  calls.length = 0
  await api.setModelAssignment({ provider: 'p', model: 'm' })
  assert.deepEqual(calls.map(([path, init]) => [path.split('?')[0], init.method]), [['/api/model/set', 'POST']])
})
