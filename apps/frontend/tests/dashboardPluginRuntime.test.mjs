import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardPluginDefinition, dashboardPluginEntryKey } from '../src/features/dashboard-plugins/dashboardPluginDefinition.ts'
import { DashboardPluginRuntime } from '../src/features/dashboard-plugins/dashboardPluginRuntime.ts'
import { DashboardPluginToast } from '../src/features/dashboard-plugins/dashboardPluginSdkComponents.ts'

test('Dashboard status separates manifest declarations, actual registrations and asset errors', () => {
  const manifest = { name: 'starter', entry: 'index.js', slots: ['chat:top'], tab: { path: '/starter', hidden: true } }
  const loaded = { script: 'loaded', styleFailed: true }
  assert.equal(dashboardPluginDefinition(manifest, undefined, false, []).status, 'loading')
  assert.deepEqual(dashboardPluginDefinition(manifest, loaded, false, []), {
    manifest, status: 'unregistered', pageRegistered: false, registeredSlots: [], styleFailed: true,
  })
  assert.equal(dashboardPluginDefinition(manifest, loaded, false, ['chat:top']).status, 'registered')
  assert.equal(dashboardPluginDefinition(manifest, { script: 'failed', styleFailed: false }, false, []).status, 'asset-failed')
})

test('Dashboard metadata changes keep the loaded entry and asset changes replace it', () => {
  const manifest = { entry: 'index.js', css: 'style.css', version: '1', source: 'user', label: 'Starter' }
  assert.equal(dashboardPluginEntryKey(manifest), dashboardPluginEntryKey({ ...manifest, label: 'Updated label' }))
  assert.notEqual(dashboardPluginEntryKey(manifest), dashboardPluginEntryKey({ ...manifest, version: '2' }))
  assert.notEqual(dashboardPluginEntryKey(manifest), dashboardPluginEntryKey({ ...manifest, css: null }))
})

test('stale dashboard plugin runtime cannot fall through to a new Profile', async () => {
  const calls = []
  const socket = async owner => {
    calls.push(['socket', owner])
    return { send: async () => {}, close: () => {} }
  }
  const runtimeA = new DashboardPluginRuntime('profile-a', 'zh-CN', async path => {
    calls.push(['http', 'profile-a', path])
    return new Response('{}')
  }, () => socket('profile-a'))
  await runtimeA.request('/api/config')
  await runtimeA.socket('/api/plugins/example/events', () => {})
  runtimeA.invalidate()

  const runtimeB = new DashboardPluginRuntime('profile-b', 'zh-CN', async path => {
    calls.push(['http', 'profile-b', path])
    return new Response('{}')
  }, () => socket('profile-b'))
  await assert.rejects(runtimeA.request('/api/config'), /no longer active/)
  await assert.rejects(runtimeA.socket('/api/plugins/example/events', () => {}), /no longer active/)
  assert.deepEqual(calls, [
    ['http', 'profile-a', '/api/config'],
    ['socket', 'profile-a'],
  ])

  await runtimeB.request('/api/config')
  await runtimeB.socket('/api/plugins/example/events', () => {})
  assert.deepEqual(calls.slice(-2), [['http', 'profile-b', '/api/config'], ['socket', 'profile-b']])
})

test('dashboard SDK Toast consumes the locked { toast } contract', () => {
  assert.equal(DashboardPluginToast({ toast: null }), null)
  const success = DashboardPluginToast({ toast: { message: 'Saved', type: 'success' } })
  assert.equal(success.props.children, 'Saved')
  assert.equal(success.props.role, 'status')
  assert.match(success.props.className, /success/)
  const error = DashboardPluginToast({ toast: { message: 'Failed', type: 'error' } })
  assert.equal(error.props.role, 'status')
  assert.match(error.props.className, /error/)
})

test('host invalidates HTTP after request body parsing and does not retain global request or socket fallbacks', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/features/dashboard-plugins/DashboardPluginHost.tsx', import.meta.url), 'utf8'))
  assert.match(source, /await requestBody\(init\)[\s\S]{0,120}runtime\.assertActive\(\)/)
  assert.doesNotMatch(source, /\bactiveRequest\b|\bactiveSocket\b/)
  assert.match(source, /invalidateRuntime\(runtime\)/)
})
