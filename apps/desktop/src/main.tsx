import { mountApp } from '@hermess/frontend'
import { tauriDesktopApi } from './adapter/tauriDesktopApi'

const root = document.getElementById('root')
if (!root) throw new Error('App root is missing')
mountApp(root, tauriDesktopApi)
