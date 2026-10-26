import { invoke as nativeInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { isDesktopFailure, type DesktopApi, type DesktopFailure, type GatewayEvent, type GatewayRequest, type NativeDropEvent, type ReplayResult, type ResumeResult, type Unsubscribe, type UpdateDownloadProgress } from '@hermess/contracts'

function desktopFailure(cause: unknown): DesktopFailure {
  if (isDesktopFailure(cause)) return cause
  return { kind: 'desktop_failure', code: 'operation_failed', category: 'operation' }
}

async function nativeCall<T>(action: () => Promise<T>): Promise<T> {
  try { return await action() }
  catch (cause) { throw desktopFailure(cause) }
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return nativeCall(() => nativeInvoke<T>(command, args))
}

function listenPayload<T>(event: string, handler: (payload: T) => void): Promise<Unsubscribe> {
  return nativeCall(() => listen<T>(event, message => handler(message.payload)))
}

function isSupportedRequest(value: unknown): value is GatewayRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (typeof request.id !== 'string' || !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) return false
  if (typeof request.profile !== 'string' || !request.profile) return false
  const params = request.params as Record<string, unknown>
  if (typeof params.session_id !== 'string') return false
  if (request.method === 'approval') {
    return typeof params.request_id === 'string'
      && (params.description === undefined || typeof params.description === 'string')
      && (params.command === undefined || typeof params.command === 'string')
      && (params.tool_name === undefined || params.tool_name === null || typeof params.tool_name === 'string')
      && (params.choices === undefined || Array.isArray(params.choices)
        && params.choices.every(choice => ['once', 'session', 'always', 'deny'].includes(choice)))
      && (params.allow_permanent === undefined || params.allow_permanent === null || typeof params.allow_permanent === 'boolean')
      && (params.allow_session === undefined || params.allow_session === null || typeof params.allow_session === 'boolean')
      && (params.smart_denied === undefined || params.smart_denied === null || typeof params.smart_denied === 'boolean')
      && (params.gateway_session_id === undefined || params.gateway_session_id === null || typeof params.gateway_session_id === 'string')
  }
  if (request.method === 'clarify') {
    return Array.isArray(params.questions)
      && params.questions.length > 0
      && params.questions.length <= 5
      && params.questions.every(question => question && typeof question === 'object'
        && typeof question.qid === 'string' && typeof question.question === 'string'
        && (question.choices === undefined || question.choices === null
          || Array.isArray(question.choices) && question.choices.every((choice: unknown) => typeof choice === 'string'))
        && (question.multi_select === undefined || typeof question.multi_select === 'boolean'))
      && (params.answers === undefined || params.answers === null
        || typeof params.answers === 'object' && !Array.isArray(params.answers)
          && Object.values(params.answers).every(answer => answer === null || typeof answer === 'string'))
  }
  return false
}

function supportedRequests(value: unknown, profile: string): GatewayRequest[] {
  return Array.isArray(value) ? value.map(request => request && typeof request === 'object'
    ? { ...request, profile } : request).filter(isSupportedRequest) : []
}

export const tauriDesktopApi: DesktopApi = {
  windowChrome: {
    customTitlebar: navigator.platform.startsWith('Win'),
    minimize: () => nativeCall(() => getCurrentWindow().minimize()),
    toggleMaximize: () => nativeCall(() => getCurrentWindow().toggleMaximize()),
    close: () => nativeCall(() => getCurrentWindow().close()),
    setFrontendDebugEnabled: enabled => invoke('set_frontend_debug_enabled', { enabled }),
  },
  workspacePanel: {
    listDirectory: (scope, path) => invoke('list_workspace_panel_directory', { scope, path }),
    readFile: (scope, path) => invoke('read_workspace_panel_file', { scope, path }),
    startTerminal: scope => invoke('start_panel_terminal', { scope }),
    activateTerminal: (scope, id) => invoke('activate_panel_terminal', { scope, id }),
    writeTerminal: (scope, id, data) => invoke('write_panel_terminal', { scope, id, data }),
    resizeTerminal: (scope, id, cols, rows) => invoke('resize_panel_terminal', { scope, id, cols, rows }),
    closeTerminal: (scope, id) => invoke('close_panel_terminal', { scope, id }),
    onTerminalOutput: handler => listenPayload('panel-terminal-output', handler),
  },
  profiles: {
    list: () => invoke('list_profiles'),
    dataDirectory: scope => invoke('get_profile_data_directory', { profile: scope.profile }),
    listDataDirectory: (scope, relativePath) => invoke('list_profile_data_directory', { profile: scope.profile, relativePath }),
    openDataDirectory: scope => invoke('open_profile_data_directory', { profile: scope.profile }),
    create: (name, preset) => invoke('create_profile', { name, preset }),
    select: name => invoke('select_profile', { name }),
    listPersonalities: scope => invoke('list_personalities', { profile: scope.profile }),
    listToolsets: scope => invoke('list_profile_toolsets', { profile: scope.profile }),
    applyPersonality: (scope, name, prompt) => invoke('apply_personality', { profile: scope.profile, name, prompt }),
  },
  channels: {
    status: scope => invoke('channel_status', { profile: scope.profile }),
    start: (scope, platform) => invoke('channel_qr_start', { profile: scope.profile, platform }),
    poll: (scope, id) => invoke('channel_qr_poll', { profile: scope.profile, id }),
    cancel: (scope, id) => invoke('channel_qr_cancel', { profile: scope.profile, id }),
  },
  about: {
    productInfo: () => invoke('get_product_info'),
    checkUpdates: () => invoke('check_updates'),
    downloadUpdate: (tagName, assetId) => invoke('download_update', { tagName, assetId }),
    onDownloadProgress: handler => listenPayload<UpdateDownloadProgress>('update-download-progress', handler),
  },
  extensions: {
    request: (scope, operation, payload = {}) => invoke('extension_request', { profile: scope.profile, operation, payload }),
  },
  runtime: {
    devDefaults: () => invoke('dev_backend_defaults'),
    packedDefaults: () => invoke('packed_backend_defaults'),
    startDev: (storagePath, pythonPath) => invoke('start_dev_backend', { storagePath, pythonPath }),
    startPacked: storagePath => invoke('start_packed_backend', { storagePath }),
    ping: () => invoke('ping_backend'),
    reconnect: () => invoke('reconnect_backend'),
    restartGracefully: () => invoke('restart_backend_gracefully'),
    stop: () => invoke('stop_backend'),
    probeLocalTools: () => invoke('probe_local_tools'),
  },
  tools: {
    listBundledTools: () => invoke('list_bundled_tools'),
    listDownloadableTools: () => invoke('list_downloadable_tools'),
    installDownloadableTool: name => invoke('install_downloadable_tool', { name }),
  },
  diagnostics: {
    readLogs: (storagePath, source) => invoke('read_diagnostic_logs', { storagePath, source }),
    recordEvent: (storagePath, event) => invoke('record_client_event', { storagePath, event }),
  },
  agentSettings: {
    schema: scope => invoke('get_agent_config_schema', { profile: scope.profile }),
    config: scope => invoke('get_agent_config', { profile: scope.profile }),
    raw: scope => invoke('get_agent_config_raw', { profile: scope.profile }),
    saveField: (scope, key, value) => invoke('save_agent_config_field', { profile: scope.profile, key, value }),
    saveRaw: (scope, yamlText, expectedYaml) => invoke('save_agent_config_raw', { profile: scope.profile, yamlText, expectedYaml }),
    saveAuxiliary: (scope, route) => invoke('save_auxiliary_route', { profile: scope.profile, ...route }),
  },
  personalFiles: {
    read: (scope, kind) => invoke('read_personal_file', { profile: scope.profile, kind }),
    save: (scope, args) => invoke('save_personal_file', { profile: scope.profile, ...args }),
  },
  models: {
    options: (scope, args) => invoke('list_model_options', { profile: scope.profile, sessionId: scope.kind === 'session' ? scope.sessionId : undefined, ...args }),
    savedConfig: scope => invoke('get_saved_model_config', { profile: scope.profile }),
    endpoints: scope => invoke('list_custom_endpoints', { profile: scope.profile }),
    loadLists: (scope, storagePath) => invoke('load_model_lists', { profile: scope.profile, storagePath }),
    saveLists: (scope, storagePath, lists) => invoke('save_model_lists', { profile: scope.profile, storagePath, lists }),
    addEndpoint: (scope, args) => invoke('add_custom_endpoint', { profile: scope.profile, ...args }),
    deleteEndpoint: (scope, endpointId) => invoke('delete_custom_endpoint', { profile: scope.profile, endpointId }),
    setDefault: (scope, args) => invoke('set_default_model', { profile: scope.profile, ...args }),
    checkRuntime: scope => invoke('check_model_runtime', { profile: scope.profile }),
    selectChat: (scope, args) => invoke('select_chat_model', { profile: scope.profile, sessionId: scope.sessionId, ...args }),
  },
  usage: {
    statistics: (scope, days) => invoke('get_usage_statistics', { profile: scope.profile, days }),
  },
  chat: {
    createSession: (scope, cwd) => invoke('create_chat_session', { profile: scope.profile, cwd }),
    resumeSession: async scope => {
      const result = await invoke<ResumeResult>('resume_chat_session', { profile: scope.profile, sessionId: scope.sessionId })
      return { ...result, open_requests: supportedRequests(result.open_requests, scope.profile) }
    },
    listSessions: scope => invoke('list_chat_sessions', { profile: scope.profile }),
    submitPrompt: (scope, text) => invoke('submit_chat_prompt', { profile: scope.profile, sessionId: scope.sessionId, text }),
    interruptSession: scope => invoke('interrupt_chat_session', { profile: scope.profile, sessionId: scope.sessionId }),
    replayEvents: async (scope, lastSeen, replayEpoch) => {
      const result = await invoke<ReplayResult>('replay_chat_events', { profile: scope.profile, sessionId: scope.sessionId, lastSeen, replayEpoch })
      return { ...result, open_requests: supportedRequests(result.open_requests, scope.profile) }
    },
    usage: scope => invoke('get_chat_usage', { profile: scope.profile, sessionId: scope.sessionId }),
    reasoning: scope => invoke('get_chat_reasoning', { profile: scope.profile, sessionId: scope.kind === 'session' ? scope.sessionId : '' }),
    setReasoning: (scope, value) => invoke('set_chat_reasoning', { profile: scope.profile, sessionId: scope.sessionId, value }),
    commands: scope => invoke('list_composer_commands', { profile: scope.profile, sessionId: scope.sessionId }),
    executeCommand: (scope, command) => invoke('execute_composer_command', { profile: scope.profile, sessionId: scope.sessionId, command }),
    dispatchSkill: (scope, name, arg) => invoke('dispatch_composer_skill', { profile: scope.profile, sessionId: scope.sessionId, name, arg }),
    attachFile: (scope, path) => invoke('attach_chat_file', { profile: scope.profile, sessionId: scope.sessionId, path }),
    detachImage: (scope, path) => invoke('detach_chat_image', { profile: scope.profile, sessionId: scope.sessionId, path }),
    answerRequest: (scope, args) => invoke('answer_gateway_request', { profile: scope.profile, sessionId: scope.sessionId, ...args }),
  },
  events: {
    onGatewayEvent: handler => listenPayload<GatewayEvent>('hermes-event', handler),
    onGatewayRequest: handler => listenPayload<unknown>('hermes-request', request => {
      if (isSupportedRequest(request)) handler(request)
    }),
    onDisconnect: handler => listenPayload('hermes-disconnected', handler),
  },
  nativeFiles: {
    choose: options => nativeCall(() => open(options)),
    onDrop: handler => nativeCall(() => getCurrentWebview().onDragDropEvent(event => {
      const payload = event.payload
      const mapped: NativeDropEvent = payload.type === 'drop'
        ? { type: 'drop', paths: payload.paths }
        : { type: payload.type }
      handler(mapped)
    })),
  },
}
