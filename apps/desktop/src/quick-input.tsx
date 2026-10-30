import React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { QuickInputView, type QuickInputApi } from '@hermess/frontend'
import { installWindowErrorLogging, recordClientError } from './adapter/errorLogging'

installWindowErrorLogging()
const api: QuickInputApi = {
  target: () => invoke('get_quick_target'),
  submit: (requestId, target, text) => invoke('submit_quick_input', { requestId, target, text }),
  onResult: handler => listen<{ requestId: string; error: string | null }>('quick-input-result', event => handler(event.payload)),
  hide: () => getCurrentWindow().hide(),
}
createRoot(document.getElementById('root')!, {
  onUncaughtError: error => recordClientError('quick_input_error', error),
}).render(<QuickInputView api={api} />)
