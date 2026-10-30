import { mountApp } from '@hermess/frontend'
import { tauriDesktopApi } from './adapter/tauriDesktopApi'
import { installWindowErrorLogging, recordClientError } from './adapter/errorLogging'

installWindowErrorLogging()
const root = document.getElementById('root')
if (!root) throw new Error('App root is missing')
mountApp(root, tauriDesktopApi, error => recordClientError('react_render_error', error))
