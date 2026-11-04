import type { View } from '../../app/types'
import type { SettingsPage } from '../settings/model'
import type { ProfileTab } from '../profiles/ProfileOverview'

const modelPages = new Set<SettingsPage>(['delegation', 'providers', 'credential-pool', 'main', 'fallbacks', 'auxiliary', 'moa'])
const configPages = new Set<SettingsPage>(['security-approvals', 'security-privacy', 'security-checkpoints', 'advanced-runtime', 'advanced-tools', 'advanced-terminal', 'advanced-output', 'advanced-config', 'browser'])
const systemPages = new Set<SettingsPage>(['shell-hooks', 'curator', 'system-operations', 'runtime', 'runtime-status', 'runtime-backup', 'diagnostics', 'update'])

type RouteState = {
  view: View
  settingsPage: SettingsPage
  profileTab: ProfileTab
  profileCreateOpen: boolean
}

export function dashboardBuiltinRoute({ view, settingsPage, profileTab, profileCreateOpen }: RouteState): string | null {
  if (view === 'chat') return '/chat'
  if (view === 'sessions') return '/sessions'
  if (view === 'files') return '/files'
  if (view === 'usage') return '/analytics'
  if (view === 'scheduled') return '/cron'
  if (view === 'channels') return '/channels'
  if (view === 'webhooks') return '/webhooks'
  if (view === 'profiles') {
    if (profileCreateOpen) return '/profiles/new'
    if (profileTab === 'skills') return '/skills'
    if (profileTab === 'plugins') return '/plugins'
    if (profileTab === 'mcp') return '/mcp'
    return '/profiles'
  }
  if (view !== 'settings') return null
  if (modelPages.has(settingsPage)) return '/models'
  if (settingsPage === 'pairing') return '/pairing'
  if (settingsPage === 'logs') return '/logs'
  if (settingsPage === 'env-keys') return '/env'
  if (settingsPage === 'documentation') return '/docs'
  if (systemPages.has(settingsPage)) return '/system'
  if (configPages.has(settingsPage)) return '/config'
  return null
}

const pageSlots = new Map<string, string>([
  ['/chat', 'chat'],
  ['/sessions', 'sessions'],
  ['/files', 'files'],
  ['/analytics', 'analytics'],
  ['/models', 'models'],
  ['/logs', 'logs'],
  ['/cron', 'cron'],
  ['/skills', 'skills'],
  ['/plugins', 'plugins'],
  ['/config', 'config'],
  ['/env', 'env'],
  ['/docs', 'docs'],
])

export function dashboardPageSlot(route: string | null): string | null {
  return route ? pageSlots.get(route) || null : null
}

export function normalizeDashboardRoute(pathname: string): string {
  const route = pathname.trim().split(/[?#]/, 1)[0] || '/'
  if (!route.startsWith('/')) return `/${route}`
  return route.length > 1 ? route.replace(/\/+$/, '') : route
}

const lockedBuiltinRoutes = new Set([
  '/', '/chat', '/sessions', '/files', '/analytics', '/models', '/logs', '/cron', '/skills', '/plugins',
  '/mcp', '/pairing', '/channels', '/webhooks', '/system', '/profiles', '/profiles/new', '/config', '/env', '/docs',
])

export function dashboardPluginForRoute<T extends { tab: { path: string; override?: string | null } }>(plugins: T[], pathname: string): T | null {
  const route = normalizeDashboardRoute(pathname)
  if (!lockedBuiltinRoutes.has(route)) {
    return plugins.find(plugin => !plugin.tab.override && normalizeDashboardRoute(plugin.tab.path) === route) || null
  }
  let override: T | null = null
  for (const plugin of plugins) {
    if (plugin.tab.override && normalizeDashboardRoute(plugin.tab.override) === route) override = plugin
  }
  return override
}

const lockedNav = ['/chat', '/sessions', '/files', '/analytics', '/models', '/logs', '/cron', '/skills', '/plugins', '/mcp', '/channels', '/webhooks', '/pairing', '/profiles', '/config', '/env', '/system', '/docs']

export const achievementsPluginName = 'hermes-achievements'

export function secondaryDashboardPluginTabs<T extends { name: string; tab: { path: string; position?: string | null; hidden?: boolean; override?: string | null } }>(plugins: T[]): T[] {
  return orderDashboardPluginTabs(plugins).filter(plugin => plugin.name !== achievementsPluginName)
}

export function orderDashboardPluginTabs<T extends { tab: { path: string; position?: string | null; hidden?: boolean; override?: string | null } }>(plugins: T[]): T[] {
  const merged: Array<{ path: string; plugin?: T }> = lockedNav.map(path => ({ path }))
  for (const plugin of plugins) {
    if (plugin.tab.hidden || plugin.tab.override) continue
    const item = { path: plugin.tab.path, plugin }
    const position = plugin.tab.position || 'end'
    if (position === 'end') { merged.push(item); continue }
    const before = position.startsWith('before:')
    const after = position.startsWith('after:')
    const target = before ? position.slice(7) : after ? position.slice(6) : ''
    const index = target ? merged.findIndex(entry => entry.path === `/${target}`) : -1
    merged.splice(index < 0 ? merged.length : index + (after ? 1 : 0), 0, item)
  }
  return merged.flatMap(item => item.plugin ? [item.plugin] : [])
}
