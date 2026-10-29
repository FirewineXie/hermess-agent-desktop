import React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { QuickInputView, type QuickInputApi } from '@hermess/frontend'

const api: QuickInputApi = {
  target: () => invoke('get_quick_target'),
  submit: (requestId, target, text) => invoke('submit_quick_input', { requestId, target, text }),
  onResult: handler => listen<{ requestId: string; error: string | null }>('quick-input-result', event => handler(event.payload)),
  hide: () => getCurrentWindow().hide(),
}
createRoot(document.getElementById('root')!).render(<QuickInputView api={api} />)
