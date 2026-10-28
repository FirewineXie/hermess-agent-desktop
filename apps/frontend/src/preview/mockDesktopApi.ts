import type { DesktopApi } from '@hermess/contracts'
import { previewDelegationRouting, previewEndpoints, previewMemoryProviderConfig, previewMoaConfig, previewModelOptions, previewSettingsConfig, previewSettingsSchema, setPreviewSetting } from './settingsMock'
import { createPreviewProfileStore } from './profileStore'
import { syncPreviewProvider } from './providerSync'
import { previewRawYaml, savePreviewRawYaml } from './rawConfig'

const previewOnly = () => new Error('此操作需要桌面客户端；当前是前端预览。')
let previewProfile = 'default'
let previewQuickEntry = { enabled: false, shortcut: 'CommandOrControl+Shift+Space', registered: false, error: 'preview' as const }
const settingsFor = createPreviewProfileStore(previewSettingsConfig)
const endpointsFor = createPreviewProfileStore(previewEndpoints)
endpointsFor('coding').splice(0)
const modelListsFor = createPreviewProfileStore(Object.fromEntries(previewModelOptions.providers.map(provider => [provider.slug, provider.models])))
const moaFor = createPreviewProfileStore(previewMoaConfig)
const delegationFor = createPreviewProfileStore(previewDelegationRouting)
const memoryFor = createPreviewProfileStore(previewMemoryProviderConfig)
const metricsFor = createPreviewProfileStore({ enabled: false, send: false, decided: true })
const previewMainModels: Record<string, { provider: string; model: string; baseUrl?: string }> = {
  default: { provider: 'openai', model: 'gpt-5.2' },
  coding: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
}
const previewMainModel = (profile: string) => previewMainModels[profile] || previewMainModels.default
let nextPreviewEndpointId = 1
function previewEndpointRows(profile: string) {
  const current = previewMainModel(profile)
  return endpointsFor(profile).map(endpoint => ({
    ...endpoint,
    is_current: endpoint.id === current.provider
      || (current.provider === 'custom' && endpoint.base_url === current.baseUrl),
  }))
}
if (new URLSearchParams(window.location.search).has('previewStaleAux')) {
  setPreviewSetting(settingsFor('default'), 'auxiliary.vision.provider', 'openrouter')
  setPreviewSetting(settingsFor('default'), 'auxiliary.vision.model', 'google/gemini-2.5-pro')
}

export const previewDesktopApi: DesktopApi = {
  links: {
    async openRepository() { window.open('https://github.com/FirewineXie/hermess-agent-desktop', '_blank', 'noopener,noreferrer') },
  },
  windowChrome: {
    customTitlebar: true,
    async minimize() {},
    async toggleMaximize() {},
    async close() {},
    async setFrontendDebugEnabled() {},
  },
  quickEntry: {
    async registration() { return { ...previewQuickEntry } },
    async save(enabled, shortcut) { previewQuickEntry = { ...previewQuickEntry, enabled, shortcut }; return { ...previewQuickEntry } },
    async onSubmit() { return () => {} },
    async acknowledge() {},
  },
  workspacePanel: {
    async listDirectory() { throw previewOnly() },
    async readFile() { throw previewOnly() },
    async startTerminal() { throw previewOnly() },
    async activateTerminal() { throw previewOnly() },
    async writeTerminal() { throw previewOnly() },
    async resizeTerminal() { throw previewOnly() },
    async closeTerminal() {},
    async onTerminalOutput() { return () => {} },
  },
  profiles: {
    async list() { return { profiles: [{ name: 'default', display_name: '默认专家', is_default: true }, { name: 'coding', display_name: '编程助手', is_default: false }], selected: previewProfile, gateway_mode: 'single', gateways: [{ profile: 'default', served_profiles: ['coding'] }], reason: null } },
    async dataDirectory() { throw previewOnly() },
    async listDataDirectory() { throw previewOnly() },
    async openDataDirectory() { throw previewOnly() },
    async create() { throw previewOnly() },
    async select(name) { previewProfile = name },
    async listPersonalities() { return { profile: 'default', active: 'none', entries: [{ name: 'technical', description: 'Technical expert', source: 'hermes' }] } },
    async listToolsets() { return [] },
    async applyPersonality() { throw previewOnly() },
  },
  channels: {
    async status() { return { platforms: [] } },
    async start() { throw previewOnly() },
    async poll() { throw previewOnly() },
    async cancel() {},
  },
  about: {
    async productInfo() { return { version: '0.1.6', hermesVersion: 'v0.22.5', hermesCommit: '882037eb8745b505db438217513c4c94f95c93c1', productLicense: 'Preview only. The desktop build reads the bundled license.', hermesLicense: 'Preview only. The desktop build reads the bundled Hermes Agent license.' } },
    async checkUpdates() { return { status: 'unavailable', releases: [] } },
    async downloadUpdate() { throw previewOnly() },
    async onDownloadProgress() { return () => {} },
  },
  extensions: {
    async request() { throw previewOnly() },
  },
  runtime: {
    async devDefaults() { return { python_path: 'PREVIEW_ONLY', storage_path: 'PREVIEW_ONLY' } },
    async packedDefaults() { return { storage_path: 'PREVIEW_ONLY', initialized: true } },
    async startDev() { return { port: 1421, pid: 1, replay_epoch: 'preview-settings', connection_id: 'local' } },
    async startPacked() { return { port: 1421, pid: 1, replay_epoch: 'preview-settings', connection_id: 'local' } },
    async ping() {},
    async reconnect() { return { port: 1421, pid: 1, replay_epoch: 'preview-settings', connection_id: 'local' } },
    async restartGracefully() { return { status: 'restarted' as const, info: { port: 1421, pid: 1, replay_epoch: 'preview-settings', connection_id: 'local' } } },
    async stop() {},
    async probeLocalTools() { return [] },
  },
  connections: {
    async testRemoteUrl() { throw previewOnly() },
    async testSsh() { return { status: 'preview_only' as const, platform: null } },
    async listSaved() { return [{ id: '2a91bac6-77a1-43f7-8f83-f74ce89c98ee', label: 'PREVIEW_ONLY Remote', kind: 'url' as const, baseUrl: 'https://gateway.example/hermes', authMode: 'token' as const }] },
    async saveRemoteUrl() { throw previewOnly() },
    async saveRemoteSsh() { throw previewOnly() },
    async deleteSaved() { throw previewOnly() },
    async applySaved() { throw previewOnly() },
    async currentRemote() {
      return new URLSearchParams(window.location.search).has('previewRemote')
        ? { connectionId: '2a91bac6-77a1-43f7-8f83-f74ce89c98ee', label: 'PREVIEW_ONLY Remote', replayEpoch: 'preview-settings', profiles: [{ name: 'default' }] }
        : null
    },
    async returnToLocal() { throw previewOnly() },
  },
  tools: {
    async listBundledTools() { return { has_manifest: false, tools: [] } },
    async listDownloadableTools() { return [] },
    async installDownloadableTool() { throw previewOnly() },
  },
  diagnostics: {
    async readLogs() { return '' },
    async recordEvent() {},
    async getWebviewCacheSettings() { return { strategy: 'size' as const, value: 512 } },
    async setWebviewCacheSettings() {},
    async clearWebviewCacheNow() {},
  },
  agentSettings: {
    async schema() { return structuredClone(previewSettingsSchema) },
    async config(scope) { return structuredClone(settingsFor(scope.profile)) },
    async checkpoints() { return { sessions: [], total_bytes: 0, preview_only: true } },
    async raw(scope) { return { path: 'PREVIEW_ONLY/config.yaml', yaml: previewRawYaml(settingsFor(scope.profile)) } },
    async saveField(scope, key, value) { setPreviewSetting(settingsFor(scope.profile), key, value) },
    async saveRaw(scope, yamlText, expectedYaml) { savePreviewRawYaml(settingsFor(scope.profile), yamlText, expectedYaml) },
    async saveAuxiliary(scope, route) {
      const config = settingsFor(scope.profile)
      setPreviewSetting(config, `auxiliary.${route.task}.provider`, route.provider)
      setPreviewSetting(config, `auxiliary.${route.task}.model`, route.model)
      setPreviewSetting(config, `auxiliary.${route.task}.reasoning_effort`, route.effort)
      setPreviewSetting(config, `auxiliary.${route.task}.timeout`, route.timeout)
    },
  },
  personalFiles: {
    async read() { throw previewOnly() },
    async save() { throw previewOnly() },
  },
  memory: {
    async providerConfig(scope, provider) { return { ...structuredClone(memoryFor(`${scope.profile}\u0000${provider}`)), name: provider, label: provider === 'honcho' ? 'Honcho' : provider } },
    async saveProviderConfig(scope, provider, values) { for (const field of memoryFor(`${scope.profile}\u0000${provider}`).fields) if (Object.hasOwn(values, field.key)) { if (field.kind === 'secret') field.is_set = Boolean(String(values[field.key] || '').trim()); else field.value = String(values[field.key] ?? '') } },
    async startOAuth() { return { auth: 'oauth', connected: false, detail: 'PREVIEW_ONLY', state: 'pending' } },
    async oauthStatus() { return { auth: 'oauth', connected: true, detail: 'PREVIEW_ONLY', state: 'connected' } },
  },
  privacy: {
    sharedMetrics: async scope => ({ ...metricsFor(scope.profile) }),
    saveSharedMetrics: async (scope, enabled) => { const value = metricsFor(scope.profile); value.enabled = enabled; value.send = enabled; return { ...value } },
  },
  delegation: {
    async routing(scope) { return structuredClone(delegationFor(scope.profile)) },
    async selectBackend(scope, backend) { delegationFor(scope.profile).configured = backend },
    async saveModelMap(scope, value) { delegationFor(scope.profile).model_map = structuredClone(value) },
    async saveProfileRoutes(scope, value) { delegationFor(scope.profile).profile_routes = structuredClone(value) },
  },
  voice: {
    async transcribe() { return { ok: true, provider: 'PREVIEW_ONLY', transcript: '这是调试预览中的模拟转写文本。' } },
    async speak() { return { ok: true, provider: 'PREVIEW_ONLY', data_url: '', mime_type: 'audio/mpeg' } },
  },
  notifications: {
    async permission() { return false },
    async requestPermission() { throw previewOnly() },
    async show() { throw previewOnly() },
  },
  models: {
    async options(scope) {
      const current = previewMainModel(scope.profile)
      const endpoints = previewEndpointRows(scope.profile)
      const providers = previewModelOptions.providers.map(item => {
        const endpoint = endpoints.find(row => row.id === item.slug)
        return { ...structuredClone(item), models: endpoint?.models || item.models,
          api_url: endpoint?.base_url || item.api_url, is_current: item.slug === current.provider }
      })
      for (const endpoint of endpoints) {
        if (!providers.some(item => item.slug === endpoint.id)) {
          providers.push({ slug: endpoint.id, name: endpoint.name, models: endpoint.models,
            authenticated: true, api_url: endpoint.base_url, is_current: endpoint.is_current })
        }
      }
      return { providers, provider: current.provider, model: current.model }
    },
    async auxiliary(scope) {
      const configured = settingsFor(scope.profile).auxiliary as Record<string, Record<string, unknown>> | undefined
      return {
        main: previewMainModel(scope.profile),
        tasks: Object.entries(configured || {}).filter(([, value]) => value && typeof value === 'object' && 'provider' in value).map(([task, value]) => ({
          task,
          provider: String(value.provider || 'auto'),
          model: String(value.model || ''),
          base_url: String(value.base_url || ''),
          local_endpoint: false,
        })),
      }
    },
    async savedConfig(scope) { const current = previewMainModel(scope.profile); return { provider: current.provider, model: current.model, base_url: current.baseUrl || previewEndpointRows(scope.profile).find(item => item.id === current.provider)?.base_url || previewModelOptions.providers.find(item => item.slug === current.provider)?.api_url || '' } },
    async endpoints(scope) { return { endpoints: structuredClone(previewEndpointRows(scope.profile)) } },
    async loadLists(scope) { return structuredClone(modelListsFor(scope.profile)) },
    async saveLists(scope, _storagePath, lists) {
      const current = modelListsFor(scope.profile)
      for (const key of Object.keys(current)) delete current[key]
      Object.assign(current, structuredClone(lists))
    },
    async addEndpoint(scope, args) {
      const id = `preview-${nextPreviewEndpointId++}`
      endpointsFor(scope.profile).push({ id, name: args.name, base_url: args.baseUrl, model: args.model,
        models: [args.model], source: 'providers', is_current: false, discover_models: args.discoverModels })
      if (args.makeDefault) previewMainModels[scope.profile] = { provider: id, model: args.model, baseUrl: args.baseUrl }
    },
    async updateEndpoint(scope, args) {
      const item = endpointsFor(scope.profile).find(endpoint => endpoint.id === args.endpointId)
      if (!item) throw new Error('提供商不存在')
      Object.assign(item, { name: args.name, base_url: args.baseUrl, model: args.model,
        models: item.models.includes(args.model) ? item.models : [...item.models, args.model],
        discover_models: args.discoverModels })
      if (args.makeDefault) previewMainModels[scope.profile] = { provider: item.id, model: args.model, baseUrl: args.baseUrl }
    },
    async setEndpointDiscovery(scope, endpointId, enabled) { const item = endpointsFor(scope.profile).find(endpoint => endpoint.id === endpointId); if (item) item.discover_models = enabled },
    async deleteEndpoint(scope, endpointId) {
      const endpoints = endpointsFor(scope.profile)
      const index = endpoints.findIndex(endpoint => endpoint.id === endpointId)
      if (index < 0) throw new Error('提供商不存在')
      endpoints.splice(index, 1)
      const current = previewMainModel(scope.profile)
      if (current.provider === endpointId) {
        previewMainModels[scope.profile] = { provider: '', model: current.model }
      }
    },
    async syncProvider(scope, args) {
      const source = endpointsFor(scope.profile).find(item => item.id === args.endpointId)
      return { sourceProfile: scope.profile, endpointId: args.endpointId,
        targets: args.targetProfiles.map(profile => syncPreviewProvider(source, endpointsFor(profile), profile, args.apply, args.replaceConflicts)) }
    },
    async moa(scope) { return structuredClone(moaFor(scope.profile)) },
    async saveMoa(scope, config) { const value = moaFor(scope.profile); Object.assign(value, structuredClone(config)); return { ...structuredClone(value), ok: true } },
    async setDefault(scope, args) { previewMainModels[scope.profile] = { provider: args.provider, model: args.model, baseUrl: args.baseUrl }; return { ok: true, provider: args.provider, model: args.model } },
    async checkRuntime(scope) { return { ok: true, ...previewMainModel(scope.profile) } },
    async selectChat() { throw previewOnly() },
  },
  usage: {
    async statistics() { throw previewOnly() },
  },
  chat: {
    async createSession() { throw previewOnly() },
    async resumeSession() { throw previewOnly() },
    async listSessions() { return { sessions: [] } },
    async submitPrompt() { throw previewOnly() },
    async interruptSession() { throw previewOnly() },
    async replayEvents() { throw previewOnly() },
    async usage() { throw previewOnly() },
    async reasoning() { throw previewOnly() },
    async setReasoning() { throw previewOnly() },
    async commands() { throw previewOnly() },
    async executeCommand() { throw previewOnly() },
    async dispatchSkill() { throw previewOnly() },
    async attachFile() { throw previewOnly() },
    async inspectFile() { throw previewOnly() },
    async detachImage() { throw previewOnly() },
    async answerRequest() { throw previewOnly() },
  },
  events: {
    async onGatewayEvent() { return () => {} },
    async onGatewayRequest() { return () => {} },
    async onDisconnect() { return () => {} },
  },
  nativeFiles: {
    async choose() { return null },
    async onDrop() { return () => {} },
  },
}
