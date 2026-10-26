import { mountApp } from './public'
import { previewDesktopApi } from './preview/mockDesktopApi'

const root = document.getElementById('root')
if (!root) throw new Error('Preview root is missing')
mountApp(root, previewDesktopApi)
