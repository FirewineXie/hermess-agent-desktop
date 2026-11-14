import { createDashboardPluginAdminApi } from './dashboardPluginAdminApi.ts'
import { createDashboardPluginCoreApi } from './dashboardPluginCoreApi.ts'

type JsonRequest = (path: string, init?: RequestInit) => Promise<unknown>

const appendProfileParam = (path: string, profile: string) => {
  if (!profile) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}profile=${encodeURIComponent(profile)}`
}

const profileQuery = (profile?: string) => profile ? `?profile=${encodeURIComponent(profile)}` : ''
const pluginPath = (name: string) => name.split('/').map(encodeURIComponent).join('/')
const profileScopedPrefixes = ['/api/status', '/api/sessions', '/api/chat/workspaces', '/api/gateway', '/api/analytics', '/api/cron', '/api/skills', '/api/tools/toolsets', '/api/config', '/api/env', '/api/mcp', '/api/messaging/platforms', '/api/messaging/telegram/onboarding', '/api/messaging/whatsapp/onboarding', '/api/providers/oauth', '/api/model/', '/api/local-models', '/api/pairing', '/api/memory', '/api/curator', '/api/webhooks', '/api/ops', '/api/logs', '/api/credentials', '/api/dashboard/agent-plugins', '/api/dashboard/plugin-providers', '/api/dashboard/theme', '/api/dashboard/font', '/api/dashboard/plugins', '/api/plugins/', '/api/shared-metrics']

type ActionResponse = { name: string; ok: boolean; pid: number | null; error?: string; message?: string }

function lifecyclePid(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const pid = (value as { pid?: unknown }).pid
  return typeof pid === 'number' && Number.isFinite(pid) ? pid : null
}

export function assertDashboardPluginBodyProfile(body: unknown, profile: string) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return
  const explicit = (body as { profile?: unknown }).profile
  if (typeof explicit === 'string' && explicit && explicit !== profile) {
    throw new Error('Plugin API cannot target another Profile')
  }
}

export function dashboardPluginApiPath(input: string, profile: string) {
  const url = new URL(input, 'http://hermess.local')
  if (url.origin !== 'http://hermess.local' || !url.pathname.startsWith('/api/')) throw new Error('Plugin API path is outside the allowed boundary')
  if (profileScopedPrefixes.some(prefix => url.pathname.startsWith(prefix))) {
    const explicit = url.searchParams.get('profile')
    if (explicit && explicit !== profile) throw new Error('Plugin API cannot target another Profile')
    if (!explicit) url.searchParams.set('profile', profile)
  }
  return `${url.pathname}${url.search}`
}

/** Locked Dashboard SDK API, bound to the Profile that owns the loaded bundle. */
export function createDashboardPluginApi(fetchJSON: JsonRequest, authedFetch: JsonRequest,
  buildWsUrl: (path: string, params?: Record<string, string>) => Promise<string>, profile: string,
  lifecycle: { start(): Promise<unknown>; stop(): Promise<unknown>; restart(): Promise<unknown> },
  buildHttpUrl: (path: string) => string, readHermesVersion: () => Promise<string>) {
  const appendQueryParam = (url: string, key: string, value?: string) => value
    ? `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}` : url
  const normalizeSessionQueryOptions = (value?: string | Record<string, unknown>, order = 'created') =>
    typeof value === 'string' ? { profile: value, order } : { profile, order, ...(value || {}) }
  const appendSessionFilters = (url: string, options: Record<string, unknown>) => {
    let next = appendQueryParam(url, 'source', typeof options.source === 'string' ? options.source : undefined)
    if (Array.isArray(options.sources) && options.sources.length) next = appendQueryParam(next, 'sources', options.sources.join(','))
    if (Array.isArray(options.excludeSources) && options.excludeSources.length) next = appendQueryParam(next, 'exclude_sources', options.excludeSources.join(','))
    return appendProfileParam(next, String(options.profile || ''))
  }
  const mutateSessionHttp = async (id: string, method: 'PATCH' | 'DELETE' | 'POST', payload: Record<string, unknown>, target: string) => {
    const path = `/api/sessions/${encodeURIComponent(id)}`
    const suffix = profileQuery(target)
    const identity = await fetchJSON(`${path}/mutation-snapshot${suffix}`) as Record<string, unknown>
    if (method === 'DELETE') {
      const params = new URLSearchParams(target ? { profile: target } : {})
      for (const [name, value] of Object.entries(identity)) params.set(name, String(value))
      return fetchJSON(`${path}?${params}`, { method })
    }
    const { expected_generation: generation, ...base } = identity
    return fetchJSON(method === 'POST' ? '/api/sessions/import' : path, { method,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, ...base,
        ...(method === 'PATCH' ? { expected_generation: generation } : {}), profile: target || undefined }) })
  }
  const runtime = { fetchJSON, authedFetch, buildWsUrl, appendProfileParam, appendQueryParam, profileQuery, pluginPath,
    normalizeSessionQueryOptions, appendSessionFilters, mutateSessionHttp, getManagementProfile: () => profile }
  const core = createDashboardPluginCoreApi(runtime)
  const admin = createDashboardPluginAdminApi(runtime)
  const lifecycleAction = async (name: string, operation: () => Promise<unknown>, message?: string): Promise<ActionResponse> => {
    const result = await operation()
    return { name, ok: true, pid: lifecyclePid(result), ...(message ? { message } : {}) }
  }
  return {
    buildWsUrl, ...core, ...admin,
    logout: async () => new Response(null, { status: 204, statusText: 'No Content' }),
    exportSessionUrl: (id: string, target = profile) => {
      if (target !== profile) throw new Error('Plugin API cannot target another Profile')
      return buildHttpUrl(appendProfileParam(`/api/sessions/${encodeURIComponent(id)}/export`, target))
    },
    startGateway: () => lifecycleAction('gateway-start', lifecycle.start),
    stopGateway: () => lifecycleAction('gateway-stop', lifecycle.stop),
    restartGateway: () => lifecycleAction('gateway-restart', lifecycle.restart),
    getGatewayMigratePlan: async () => ({ already_multiplexed: true, blockers: [], command: '', eligible: false,
      notices: ['Gateway lifecycle is managed by Hermess Agent Desktop.'], profiles: [] }),
    migrateGatewayToMultiplex: async (): Promise<ActionResponse> => ({ name: 'gateway-migrate', ok: true, pid: null,
      message: 'Gateway is already managed by Hermess Agent Desktop.' }),
    checkHermesUpdate: async (_force = false) => {
      const version = await readHermesVersion()
      return { install_method: 'desktop-app', current_version: version.replace(/^v/, ''), behind: null,
        update_available: false, can_apply: false, update_command: '', message: 'Hermes updates are managed by Hermess Agent Desktop.' }
    },
    updateHermes: async (): Promise<ActionResponse> => ({ name: 'hermes-update', ok: false, pid: null,
      error: 'Hermes updates are managed by Hermess Agent Desktop.' }),
    getPortal: async () => ({ logged_in: false, portal_url: null, inference_url: null, provider: '', subscription_url: '', features: [] }),
    getCronJobs: (target = profile) => core.getCronJobs(target),
    getCronDeliveryTargets: (target = profile) => core.getCronDeliveryTargets(target),
    createCronJob: (job: unknown, target = profile) => core.createCronJob(job, target),
    updateCronJob: (id: string, updates: unknown, target = profile) => core.updateCronJob(id, updates, target),
    pauseCronJob: (id: string, target = profile) => core.pauseCronJob(id, target),
    resumeCronJob: (id: string, target = profile) => core.resumeCronJob(id, target),
    triggerCronJob: (id: string, target = profile) => core.triggerCronJob(id, target),
    deleteCronJob: (id: string, target = profile) => core.deleteCronJob(id, target),
    getAutomationBlueprints: (target = profile) => core.getAutomationBlueprints(target),
    instantiateAutomationBlueprint: (body: unknown, target = profile) => core.instantiateAutomationBlueprint(body as never, target),
    getSkills: (target = profile) => core.getSkills(target),
    toggleSkill: (name: string, enabled: boolean, target = profile) => core.toggleSkill(name, enabled, target),
    getSkillContent: (name: string, target = profile) => core.getSkillContent(name, target),
    createSkill: (skill: unknown, target = profile) => core.createSkill(skill as never, target),
    updateSkillContent: (name: string, content: string, target = profile) => core.updateSkillContent(name, content, target),
    getToolsets: (target = profile) => core.getToolsets(target),
    toggleToolset: (name: string, enabled: boolean, target = profile) => core.toggleToolset(name, enabled, target),
    getToolsetConfig: (name: string, target = profile) => core.getToolsetConfig(name, target),
    selectToolsetProvider: (name: string, provider: string, target = profile) => core.selectToolsetProvider(name, provider, target),
    saveToolsetEnv: (name: string, values: unknown, target = profile) => core.saveToolsetEnv(name, values as never, target),
    runToolsetPostSetup: (name: string, key: string, target = profile) => core.runToolsetPostSetup(name, key, target),
    installSkillFromHub: (identifier: string, target = profile) => admin.installSkillFromHub(identifier, target),
    uninstallSkillFromHub: (name: string, target = profile) => admin.uninstallSkillFromHub(name, target),
    updateSkillsFromHub: (target = profile) => admin.updateSkillsFromHub(target),
    searchSkillsHub: (q: string, source = 'all', limit = 20, target = profile) => admin.searchSkillsHub(q, source, limit, target),
    getSkillHubSources: (target = profile) => admin.getSkillHubSources(target),
  }
}
