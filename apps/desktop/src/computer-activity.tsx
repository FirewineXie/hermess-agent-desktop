import React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ComputerActivityApi, ComputerActivityStatus } from '@hermess/contracts'
import { ComputerActivityView } from '@hermess/frontend'
import { installWindowErrorLogging, recordClientError } from './adapter/errorLogging'

installWindowErrorLogging()
const api: ComputerActivityApi = {
  read: () => invoke('get_computer_activity'),
  stop: () => invoke('stop_computer_activity'),
  onChange: handler => listen<ComputerActivityStatus>('computer-activity', event => handler(event.payload)),
}
createRoot(document.getElementById('root')!, {
  onUncaughtError: error => recordClientError('react_render_error', error),
}).render(<ComputerActivityView api={api} />)
