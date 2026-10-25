import { invoke as nativeInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
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

function supportedRequests(value: unknown): GatewayRequest[] {
  return Array.isArray(value) ? value.filter(isSupportedRequest) : []
}

export const tauriDesktopApi: DesktopApi = {
  channels: {
    status: () => invoke('channel_status'),
    start: platform => invoke('channel_qr_start', { platform }),
    poll: id => invoke('channel_qr_poll', { id }),
    cancel: id => invoke('channel_qr_cancel', { id }),
  },
  about: {
    productInfo: () => invoke('get_product_info'),
    checkUpdates: () => invoke('check_updates'),
    downloadUpdate: (tagName, assetId) => invoke('download_update', { tagName, assetId }),
    onDownloadProgress: handler => listenPayload<UpdateDownloadProgress>('update-download-progress', handler),
  },
  extensions: {
    request: (operation, payload = {}) => invoke('extension_request', { operation, payload }),
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
    listAgentToolsets: sessionId => invoke('list_agent_toolsets', { sessionId }),
    listActiveAgentTools: sessionId => invoke('list_active_agent_tools', { sessionId }),
    listBundledTools: () => invoke('list_bundled_tools'),
  },
  diagnostics: {
    readLogs: (storagePath, source) => invoke('read_diagnostic_logs', { storagePath, source }),
    recordEvent: (storagePath, event) => invoke('record_client_event', { storagePath, event }),
  },
  agentSettings: {
    schema: () => invoke('get_agent_config_schema'),
    config: () => invoke('get_agent_config'),
    raw: () => invoke('get_agent_config_raw'),
    saveField: (key, value) => invoke('save_agent_config_field', { key, value }),
    saveRaw: (yamlText, expectedYaml) => invoke('save_agent_config_raw', { yamlText, expectedYaml }),
    saveAuxiliary: route => invoke('save_auxiliary_route', route),
  },
  personalFiles: {
    read: kind => invoke('read_personal_file', { kind }),
    save: args => invoke('save_personal_file', args),
    listProject: sessionId => invoke('list_project_files', { sessionId }),
    readProject: (sessionId, path) => invoke('read_project_file', { sessionId, path }),
    saveProject: args => invoke('save_project_file', args),
  },
  models: {
    options: args => invoke('list_model_options', args),
    savedConfig: () => invoke('get_saved_model_config'),
    endpoints: () => invoke('list_custom_endpoints'),
    loadLists: storagePath => invoke('load_model_lists', { storagePath }),
    saveLists: (storagePath, lists) => invoke('save_model_lists', { storagePath, lists }),
    addEndpoint: args => invoke('add_custom_endpoint', args),
    deleteEndpoint: endpointId => invoke('delete_custom_endpoint', { endpointId }),
    setDefault: args => invoke('set_default_model', args),
    checkRuntime: () => invoke('check_model_runtime'),
    selectChat: args => invoke('select_chat_model', args),
  },
  usage: {
    statistics: days => invoke('get_usage_statistics', { days }),
  },
  chat: {
    createSession: cwd => invoke('create_chat_session', { cwd }),
    resumeSession: async sessionId => {
      const result = await invoke<ResumeResult>('resume_chat_session', { sessionId })
      return { ...result, open_requests: supportedRequests(result.open_requests) }
    },
    listSessions: () => invoke('list_chat_sessions'),
    submitPrompt: (sessionId, text) => invoke('submit_chat_prompt', { sessionId, text }),
    interruptSession: sessionId => invoke('interrupt_chat_session', { sessionId }),
    replayEvents: async (sessionId, lastSeen, replayEpoch) => {
      const result = await invoke<ReplayResult>('replay_chat_events', { sessionId, lastSeen, replayEpoch })
      return { ...result, open_requests: supportedRequests(result.open_requests) }
    },
    usage: sessionId => invoke('get_chat_usage', { sessionId }),
    reasoning: sessionId => invoke('get_chat_reasoning', { sessionId }),
    setReasoning: (sessionId, value) => invoke('set_chat_reasoning', { sessionId, value }),
    commands: sessionId => invoke('list_composer_commands', { sessionId }),
    executeCommand: (sessionId, command) => invoke('execute_composer_command', { sessionId, command }),
    dispatchSkill: (sessionId, name, arg) => invoke('dispatch_composer_skill', { sessionId, name, arg }),
    attachFile: (sessionId, path) => invoke('attach_chat_file', { sessionId, path }),
    detachImage: (sessionId, path) => invoke('detach_chat_image', { sessionId, path }),
    answerRequest: args => invoke('answer_gateway_request', args),
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
