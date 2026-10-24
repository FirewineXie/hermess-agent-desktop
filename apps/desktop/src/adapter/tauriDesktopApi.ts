import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import type { DesktopApi, GatewayEvent, GatewayRequest, NativeDropEvent, Unsubscribe } from '@hermess/contracts'

function listenPayload<T>(event: string, handler: (payload: T) => void): Promise<Unsubscribe> {
  return listen<T>(event, message => handler(message.payload))
}

export const tauriDesktopApi: DesktopApi = {
  runtime: {
    devDefaults: () => invoke('dev_backend_defaults'),
    packedDefaults: () => invoke('packed_backend_defaults'),
    startDev: (storagePath, pythonPath) => invoke('start_dev_backend', { storagePath, pythonPath }),
    startPacked: storagePath => invoke('start_packed_backend', { storagePath }),
    ping: () => invoke('ping_backend'),
    reconnect: () => invoke('reconnect_backend'),
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
  chat: {
    createSession: () => invoke('create_chat_session'),
    resumeSession: sessionId => invoke('resume_chat_session', { sessionId }),
    listSessions: () => invoke('list_chat_sessions'),
    submitPrompt: (sessionId, text) => invoke('submit_chat_prompt', { sessionId, text }),
    interruptSession: sessionId => invoke('interrupt_chat_session', { sessionId }),
    replayEvents: (sessionId, lastSeen, replayEpoch) => invoke('replay_chat_events', { sessionId, lastSeen, replayEpoch }),
    usage: sessionId => invoke('get_chat_usage', { sessionId }),
    reasoning: sessionId => invoke('get_chat_reasoning', { sessionId }),
    commands: sessionId => invoke('list_composer_commands', { sessionId }),
    executeCommand: (sessionId, command) => invoke('execute_composer_command', { sessionId, command }),
    dispatchSkill: (sessionId, name, arg) => invoke('dispatch_composer_skill', { sessionId, name, arg }),
    attachFile: (sessionId, path) => invoke('attach_chat_file', { sessionId, path }),
    detachImage: (sessionId, path) => invoke('detach_chat_image', { sessionId, path }),
    answerRequest: args => invoke('answer_gateway_request', args),
  },
  events: {
    onGatewayEvent: handler => listenPayload<GatewayEvent>('hermes-event', handler),
    onGatewayRequest: handler => listenPayload<GatewayRequest>('hermes-request', handler),
    onDisconnect: handler => listenPayload('hermes-disconnected', handler),
  },
  nativeFiles: {
    choose: options => open(options),
    onDrop: handler => getCurrentWebview().onDragDropEvent(event => {
      const payload = event.payload
      const mapped: NativeDropEvent = payload.type === 'drop'
        ? { type: 'drop', paths: payload.paths }
        : { type: payload.type }
      handler(mapped)
    }),
  },
}
