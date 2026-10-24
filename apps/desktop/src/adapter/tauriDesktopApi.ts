import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import type { DesktopApi, DesktopEvent, NativeDropEvent, Unsubscribe } from '@hermess/contracts'

function listenEvent<T>(event: string, handler: (event: DesktopEvent<T>) => void): Promise<Unsubscribe> {
  return listen<T>(event, message => handler({ payload: message.payload }))
}

export const tauriDesktopApi: DesktopApi = {
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
