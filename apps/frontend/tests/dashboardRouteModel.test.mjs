import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { achievementsPluginName, dashboardBuiltinRoute, dashboardPageSlot, dashboardPluginForRoute, normalizeDashboardRoute, orderDashboardPluginTabs, secondaryDashboardPluginTabs } from '../src/features/dashboard-plugins/dashboardRouteModel.ts'

const base = { settingsPage: 'about', profileTab: 'overview', profileCreateOpen: false }

test('every locked built-in route maps to its product-owned page', () => {
  const cases = [
    [{ ...base, view: 'chat' }, '/chat'],
    [{ ...base, view: 'sessions' }, '/sessions'],
    [{ ...base, view: 'settings', settingsPage: 'sessions' }, '/sessions'],
    [{ ...base, view: 'files' }, '/files'],
    [{ ...base, view: 'usage' }, '/analytics'],
    [{ ...base, view: 'scheduled' }, '/cron'],
    [{ ...base, view: 'channels' }, '/channels'],
    [{ ...base, view: 'webhooks' }, '/webhooks'],
    [{ ...base, view: 'profiles' }, '/profiles'],
    [{ ...base, view: 'profiles', profileCreateOpen: true }, '/profiles/new'],
    [{ ...base, view: 'profiles', profileTab: 'skills' }, '/skills'],
    [{ ...base, view: 'profiles', profileTab: 'plugins' }, '/plugins'],
    [{ ...base, view: 'profiles', profileTab: 'mcp' }, '/mcp'],
    [{ ...base, view: 'settings', settingsPage: 'providers' }, '/models'],
    [{ ...base, view: 'settings', settingsPage: 'pairing' }, '/pairing'],
    [{ ...base, view: 'settings', settingsPage: 'logs' }, '/logs'],
    [{ ...base, view: 'settings', settingsPage: 'env-keys' }, '/env'],
    [{ ...base, view: 'settings', settingsPage: 'documentation' }, '/docs'],
    [{ ...base, view: 'settings', settingsPage: 'runtime-status' }, '/system'],
    [{ ...base, view: 'settings', settingsPage: 'advanced-config' }, '/config'],
  ]
  for (const [state, expected] of cases) assert.equal(dashboardBuiltinRoute(state), expected)
})

test('page slots match the slot-bearing pages in the locked dashboard', () => {
  const routes = ['/chat', '/sessions', '/files', '/analytics', '/models', '/logs', '/cron', '/skills', '/plugins', '/config', '/env', '/docs']
  for (const route of routes) assert.equal(dashboardPageSlot(route), route.slice(1))
  for (const route of ['/mcp', '/pairing', '/channels', '/webhooks', '/system', '/profiles', '/profiles/new']) assert.equal(dashboardPageSlot(route), null)
})

test('all shell slots are mounted by the product shell', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/WorkspaceHeader.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/Sidebar.tsx', import.meta.url), 'utf8'),
  ])
  const source = sources.join('\n')
  for (const slot of ['backdrop', 'header-left', 'header-right', 'header-banner', 'sidebar', 'pre-main', 'post-main', 'footer-left', 'footer-right', 'overlay']) {
    assert.match(source, new RegExp(`name=["']${slot}["']`))
  }
})

test('plugin tabs honor locked before after and end ordering', () => {
  const tab = (name, position, extra = {}) => ({ name, tab: { path: `/${name}`, position, ...extra } })
  assert.deepEqual(orderDashboardPluginTabs([
    tab('tail', 'end'),
    tab('after-skills', 'after:skills'),
    tab('before-skills', 'before:skills'),
    tab('after-analytics', 'after:analytics'),
    tab('hidden', 'after:analytics', { hidden: true }),
    tab('override', 'after:analytics', { override: '/chat' }),
  ]).map(item => item.name), ['after-analytics', 'before-skills', 'after-skills', 'tail'])
})

test('hidden plugin routes stay out of navigation but remain route-addressable', () => {
  const hidden = { name: 'hidden', tab: { path: '/private-report/', hidden: true } }
  assert.deepEqual(orderDashboardPluginTabs([hidden]), [])
  assert.equal(normalizeDashboardRoute('/private-report/?tab=all#latest'), '/private-report')
  assert.equal(dashboardPluginForRoute([hidden], '/private-report')?.name, 'hidden')
})

test('the locked root route can be overridden by a plugin', () => {
  const rootOverride = { name: 'home', tab: { path: '/home', override: '/' } }
  const ordinary = { name: 'ordinary', tab: { path: '/ordinary' } }
  assert.equal(dashboardPluginForRoute([ordinary, rootOverride], '/')?.name, 'home')
  assert.equal(dashboardPluginForRoute([ordinary, rootOverride], '/ordinary')?.name, 'ordinary')
})

test('ordinary paths cannot shadow built-ins and the last explicit override wins', () => {
  const collision = { name: 'collision', tab: { path: '/models' } }
  const first = { name: 'first', tab: { path: '/first', override: '/models' } }
  const last = { name: 'last', tab: { path: '/last', override: '/models' } }
  const invalidOverride = { name: 'invalid', tab: { path: '/unused', override: '/not-built-in' } }
  assert.equal(dashboardPluginForRoute([collision], '/models'), null)
  assert.equal(dashboardPluginForRoute([first, last], '/models')?.name, 'last')
  assert.equal(dashboardPluginForRoute([invalidOverride], '/not-built-in'), null)
})

test('achievements has one product-owned sidebar entry instead of a duplicate dynamic tab', () => {
  const tab = name => ({ name, tab: { path: `/${name}`, position: 'end' } })
  assert.equal(achievementsPluginName, 'hermes-achievements')
  assert.deepEqual(
    secondaryDashboardPluginTabs([tab('other'), tab(achievementsPluginName)]).map(item => item.name),
    ['other'],
  )
})
