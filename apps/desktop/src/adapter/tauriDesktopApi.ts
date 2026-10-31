import { invoke as nativeInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isPermissionGranted, onAction, registerActionTypes, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { isDesktopFailure, type DesktopApi, type DesktopFailure, type GatewayEvent, type GatewayRequest, type NativeDropEvent, type NotificationAction, type NotificationTarget, type ReplayResult, type ResumeResult, type Unsubscribe } from '@hermess/contracts'
import { notificationApprovalChoice } from './notificationActions'

const notificationTargets = new Map<number, NotificationTarget>()
const notificationHandlers = new Set<(action: NotificationAction) => void>()
let nextNotificationId = Math.floor(Math.random() * 1_000_000_000)
let notificationListener: Promise<unknown> | null = null
let approvalActionsRegistered: Promise<void> | null = null
const nativeWindowsNotifications = navigator.platform.startsWith('Win')

type NativeNotificationAction = { id: number; actionId: string }

function ensureApprovalActions(): Promise<void> {
  if (!approvalActionsRegistered) approvalActionsRegistered = registerActionTypes([
    { id: 'hermess-approval-zh-CN', actions: [{ id: 'approve', title: '允许一次' }, { id: 'deny', title: '拒绝' }] },
    { id: 'hermess-approval-en-US', actions: [{ id: 'approve', title: 'Allow once' }, { id: 'deny', title: 'Reject' }] },
  ]).catch(error => { approvalActionsRegistered = null; throw error })
  return approvalActionsRegistered
}

function dispatchNotificationAction(id: number | undefined, actionId: string): void {
  const target = id === undefined ? undefined : notificationTargets.get(id)
  if (id !== undefined) notificationTargets.delete(id)
  if (!target) return
  const choice = notificationApprovalChoice(actionId)
  const mapped: NotificationAction | null = actionId === 'tap'
    ? { target, kind: 'open' }
    : target.approvalRequestId && choice ? { target, kind: 'approval', choice } : null
  if (!mapped) return
  void getCurrentWindow().show().then(() => getCurrentWindow().setFocus()).catch(() => {}).finally(() => {
    for (const handler of notificationHandlers) handler(mapped)
  })
}

function ensureNotificationListener(): Promise<unknown> {
  if (!notificationListener) notificationListener = (nativeWindowsNotifications
    ? listenPayload<NativeNotificationAction>('native-notification-action', action => dispatchNotificationAction(action.id, action.actionId))
    : onAction(action => dispatchNotificationAction(action.notification?.id, action.actionId))
  ).catch(error => { notificationListener = null; throw error })
  return notificationListener
}

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
  links: {
    openRepository: () => nativeCall(() => openUrl('https://github.com/FirewineXie/hermess-agent-desktop')),
  },
  windowChrome: {
    customTitlebar: navigator.platform.startsWith('Win'),
    minimize: () => nativeCall(() => getCurrentWindow().minimize()),
    toggleMaximize: () => nativeCall(() => getCurrentWindow().toggleMaximize()),
    close: () => nativeCall(() => getCurrentWindow().close()),
  },
  notifications: {
    permission: () => nativeCall(isPermissionGranted),
    requestPermission: () => nativeCall(async () => await requestPermission() === 'granted'),
    show: (title, body, target) => nativeCall(async () => {
      await ensureNotificationListener()
      const granted = await isPermissionGranted() || await requestPermission() === 'granted'
      if (!granted) throw desktopFailure(null)
      if (!nativeWindowsNotifications && target?.approvalRequestId) await ensureApprovalActions()
      const id = ++nextNotificationId % 2_147_483_647
      if (target) {
        notificationTargets.set(id, target)
        while (notificationTargets.size > 128) notificationTargets.delete(notificationTargets.keys().next().value!)
      }
      try {
        if (nativeWindowsNotifications) {
          await invoke('show_native_notification', {
            id,
            title,
            body,
            approvalLocale: target?.approvalRequestId ? target.locale : undefined,
          })
        } else {
          sendNotification({ id, title, body, actionTypeId: target?.approvalRequestId ? `hermess-approval-${target.locale}` : undefined })
        }
      } catch (cause) {
        notificationTargets.delete(id)
        throw cause
      }
    }),
    onAction: async handler => {
      await nativeCall(ensureNotificationListener)
      notificationHandlers.add(handler)
      return () => { notificationHandlers.delete(handler) }
    },
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
  localPreview: {
    readHtml: path => invoke('read_local_preview_html', { path }),
  },
  profiles: {
    list: () => invoke('list_profiles'),
    dataDirectory: scope => invoke('get_profile_data_directory', { profile: scope.profile }),
    listDataDirectory: (scope, relativePath) => invoke('list_profile_data_directory', { profile: scope.profile, relativePath }),
    openDataDirectory: scope => invoke('open_profile_data_directory', { profile: scope.profile }),
    create: (name, preset) => invoke('create_profile', { name, preset }),
    delete: name => invoke('delete_profile', { name }),
    setDisplayName: (name, displayName) => invoke('set_profile_display_name', { name, displayName }),
    inspectImport: path => invoke('inspect_workbuddy_import', { path }),
    importPackage: (path, profileName, expectedDigest) => invoke('import_workbuddy_package', { path, profileName, expectedDigest }),
    select: name => invoke('select_profile', { name }),
    listPersonalities: scope => invoke('list_personalities', { profile: scope.profile }),
    listToolsets: scope => invoke('list_profile_toolsets', { profile: scope.profile }),
    applyPersonality: (scope, name, prompt) => invoke('apply_personality', { profile: scope.profile, name, prompt }),
  },
  channels: {
    status: scope => invoke('channel_status', { profile: scope.profile }),
    save: (scope, platform, update) => invoke('channel_save', { profile: scope.profile, platform, update }),
    test: (scope, platform) => invoke('channel_test', { profile: scope.profile, platform }),
    telegramStart: scope => invoke('channel_telegram_start', { profile: scope.profile }),
    telegramPoll: (scope, id) => invoke('channel_telegram_poll', { profile: scope.profile, id }),
    telegramApply: (scope, id, allowedUserId) => invoke('channel_telegram_apply', { profile: scope.profile, id, allowedUserId }),
    telegramCancel: (scope, id) => invoke('channel_telegram_cancel', { profile: scope.profile, id }),
    vendorQrStart: (scope, platform) => invoke('channel_vendor_qr_start', { profile: scope.profile, platform }),
    vendorQrPoll: (scope, id) => invoke('channel_vendor_qr_poll', { profile: scope.profile, id }),
    vendorQrApply: (scope, id) => invoke('channel_vendor_qr_apply', { profile: scope.profile, id }),
    vendorQrCancel: (scope, id) => invoke('channel_vendor_qr_cancel', { profile: scope.profile, id }),
    whatsappStart: scope => invoke('channel_whatsapp_start', { profile: scope.profile }),
    whatsappPoll: (scope, id) => invoke('channel_whatsapp_poll', { profile: scope.profile, id }),
    whatsappApply: (scope, id) => invoke('channel_whatsapp_apply', { profile: scope.profile, id }),
    whatsappCancel: (scope, id) => invoke('channel_whatsapp_cancel', { profile: scope.profile, id }),
    start: (scope, platform) => invoke('channel_qr_start', { profile: scope.profile, platform }),
    poll: (scope, id, access) => invoke('channel_qr_poll', { profile: scope.profile, id, access }),
    approvePairing: (scope, platform, code) => invoke('channel_pairing_approve', { profile: scope.profile, platform, code }),
    cancel: (scope, id) => invoke('channel_qr_cancel', { profile: scope.profile, id }),
  },
  about: {
    productInfo: () => invoke('get_product_info'),
    checkUpdates: () => invoke('check_updates'),
    startUpdateDownload: (tagName, assetId) => invoke('start_update_download', { tagName, assetId }),
    getUpdateDownloadStatus: () => invoke('get_update_download_status'),
    onUpdateDownloadStatus: handler => listenPayload('update-download-status', handler),
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
    getWebviewCacheSettings: () => invoke('get_webview_cache_settings'),
    setWebviewCacheSettings: value => invoke('set_webview_cache_settings', { value }),
    clearWebviewCacheNow: () => invoke('clear_webview_cache_now'),
  },
  agentSettings: {
    schema: scope => invoke('get_agent_config_schema', { profile: scope.profile }),
    config: scope => invoke('get_agent_config', { profile: scope.profile }),
    raw: scope => invoke('get_agent_config_raw', { profile: scope.profile }),
    saveField: (scope, key, value) => invoke('save_agent_config_field', { profile: scope.profile, key, value }),
    saveRaw: (scope, yamlText, expectedYaml) => invoke('save_agent_config_raw', { profile: scope.profile, yamlText, expectedYaml }),
    saveAuxiliary: (scope, route) => invoke('save_auxiliary_route', { profile: scope.profile, ...route }),
  },
  security: {
    consent: scope => invoke('get_shared_metrics_consent', { profile: scope.profile }),
    saveConsent: (scope, enabled, send) => invoke('save_shared_metrics_consent', { profile: scope.profile, enabled, send }),
    checkpoints: scope => invoke('get_checkpoint_inventory', { profile: scope.profile }),
  },
  memory: {
    providers: scope => invoke('get_memory_providers', { profile: scope.profile }),
    config: (scope, provider) => invoke('get_memory_provider_config', { profile: scope.profile, provider }),
    save: (scope, provider, values) => invoke('save_memory_provider_config', { profile: scope.profile, provider, values }),
    oauthStart: (scope, provider) => invoke('start_memory_provider_oauth', { profile: scope.profile, provider }),
    oauthStatus: (scope, provider) => invoke('get_memory_provider_oauth_status', { profile: scope.profile, provider }),
  },
  personalFiles: {
    read: (scope, kind) => invoke('read_personal_file', { profile: scope.profile, kind }),
    save: (scope, args) => invoke('save_personal_file', { profile: scope.profile, ...args }),
  },
  delegation: {
    read: scope => invoke('get_delegation_routing', { profile: scope.profile }),
    save: (scope, draft) => invoke('save_delegation_routing', { profile: scope.profile, draft }),
  },
  device: {
    status: () => invoke('get_device_status'),
    save: preferences => invoke('save_device_preferences', { preferences }),
    setQuickTarget: target => invoke('set_quick_target', { target }),
    onQuickSubmit: handler => listenPayload('quick-input-submit', handler),
    takeQuickSubmission: requestId => invoke('take_quick_submission', { requestId }),
    finishQuickSubmission: (requestId, error) => invoke('finish_quick_submission', { requestId, error }),
  },
  models: {
    previewCopy: (scope, endpointId, target) => invoke('preview_provider_copy', { profile: scope.profile, endpointId, target }),
    copy: (scope, preview) => invoke('copy_provider', { profile: scope.profile, endpointId: preview.endpointId, target: preview.target, expectedDigest: preview.digest }),
    options: (scope, args) => invoke('list_model_options', { profile: scope.profile, sessionId: scope.kind === 'session' ? scope.sessionId : undefined, ...args }),
    savedConfig: scope => invoke('get_saved_model_config', { profile: scope.profile }),
    endpoints: scope => invoke('list_custom_endpoints', { profile: scope.profile }),
    loadLists: (scope, storagePath) => invoke('load_model_lists', { profile: scope.profile, storagePath }),
    saveLists: (scope, storagePath, lists) => invoke('save_model_lists', { profile: scope.profile, storagePath, lists }),
    addEndpoint: (scope, args) => invoke('add_custom_endpoint', { profile: scope.profile, ...args }),
    updateEndpoint: (scope, args) => invoke('update_custom_endpoint', { profile: scope.profile, ...args }),
    setEndpointDiscovery: (scope, endpointId, discoverModels) => invoke('set_custom_endpoint_discovery', { profile: scope.profile, endpointId, discoverModels }),
    deleteEndpoint: (scope, endpointId) => invoke('delete_custom_endpoint', { profile: scope.profile, endpointId }),
    setDefault: (scope, args) => invoke('set_default_model', { profile: scope.profile, ...args }),
    checkRuntime: scope => invoke('check_model_runtime', { profile: scope.profile }),
    selectChat: (scope, args) => invoke('select_chat_model', { profile: scope.profile, sessionId: scope.sessionId, ...args }),
    moa: scope => invoke('get_moa_config', { profile: scope.profile }),
    saveMoa: (scope, config) => invoke('save_moa_config', { profile: scope.profile, config }),
  },
  usage: {
    statistics: (scope, days) => invoke('get_usage_statistics', { profile: scope.profile, days }),
  },
  chat: {
    createSession: (scope, args) => invoke('create_chat_session', { profile: scope.profile, ...args }),
    resumeSession: async scope => {
      const result = await invoke<ResumeResult>('resume_chat_session', { profile: scope.profile, sessionId: scope.sessionId })
      return { ...result, open_requests: supportedRequests(result.open_requests, scope.profile) }
    },
    listSessions: scope => invoke('list_chat_sessions', { profile: scope.profile }),
    deleteSession: scope => invoke('delete_chat_session', { profile: scope.profile, sessionId: scope.sessionId, keepView: scope.keepView, viewSessionId: scope.viewSessionId }),
    submitPrompt: (scope, text) => invoke('submit_chat_prompt', { profile: scope.profile, sessionId: scope.sessionId, text }),
    interruptSession: scope => invoke('interrupt_chat_session', { profile: scope.profile, sessionId: scope.sessionId }),
    steerSession: (scope, text) => invoke('steer_chat_session', { profile: scope.profile, sessionId: scope.sessionId, text }),
    askSideQuestion: (scope, question) => invoke('ask_side_question', { profile: scope.profile, sessionId: scope.sessionId, question }),
    startBackgroundTask: (scope, prompt) => invoke('start_background_task', { profile: scope.profile, sessionId: scope.sessionId, prompt }),
    replayEvents: async (scope, lastSeen, replayEpoch) => {
      const result = await invoke<ReplayResult>('replay_chat_events', { profile: scope.profile, sessionId: scope.sessionId, lastSeen, replayEpoch })
      return { ...result, open_requests: supportedRequests(result.open_requests, scope.profile) }
    },
    usage: scope => invoke('get_chat_usage', { profile: scope.profile, sessionId: scope.sessionId }),
    reasoning: scope => invoke('get_chat_reasoning', { profile: scope.profile, sessionId: scope.kind === 'session' ? scope.sessionId : '' }),
    setReasoning: (scope, value) => invoke('set_chat_reasoning', { profile: scope.profile, sessionId: scope.sessionId, value }),
    commands: scope => invoke('list_composer_commands', { profile: scope.profile, sessionId: scope.kind === 'session' ? scope.sessionId : '' }),
    executeCommand: (scope, command) => invoke('execute_composer_command', { profile: scope.profile, sessionId: scope.sessionId, command }),
    exportSession: async (scope, format, redact, filename) => {
      const path = await nativeCall(() => save({
        defaultPath: filename || `hermes_conversation.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      }))
      if (!path) return null
      return invoke('export_chat_session', { profile: scope.profile, sessionId: scope.sessionId, format, redact, path })
    },
    dispatchSkill: (scope, name, arg) => invoke('dispatch_composer_skill', { profile: scope.profile, sessionId: scope.sessionId, name, arg }),
    attachFile: (scope, path) => invoke('attach_chat_file', { profile: scope.profile, sessionId: scope.sessionId, path }),
    attachImageBytes: (scope, contentBase64, name) => invoke('attach_chat_image_bytes', { profile: scope.profile, sessionId: scope.sessionId, contentBase64, name }),
    inspectFile: path => invoke('inspect_chat_file', { path }),
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
