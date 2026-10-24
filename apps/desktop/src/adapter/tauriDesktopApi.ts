import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import type { DesktopApi, DesktopEvent, NativeDropEvent, Unsubscribe } from '@hermess/contracts'

function listenEvent<T>(event: string, handler: (event: DesktopEvent<T>) => void): Promise<Unsubscribe> {
  return listen<T>(event, message => handler({ payload: message.payload }))
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
  invoke: (command, args) => invoke(command, args),
  listen: listenEvent,
  open: options => open(options),
  onDragDropEvent: handler => getCurrentWebview().onDragDropEvent(event => {
    const payload = event.payload
    const mapped: NativeDropEvent = payload.type === 'drop'
      ? { type: 'drop', paths: payload.paths }
      : { type: payload.type }
    handler({ payload: mapped })
  }),
}
