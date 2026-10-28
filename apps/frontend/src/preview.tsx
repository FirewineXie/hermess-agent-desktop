import { mountApp } from './public'
import { previewDesktopApi } from './preview/mockDesktopApi'
import { SETTINGS_CATEGORIES } from './features/settings/model'

const root = document.getElementById('root')
if (!root) throw new Error('Preview root is missing')
const [categoryId, subpageId] = new URLSearchParams(window.location.search).get('settings')?.split('.') || []
const category = SETTINGS_CATEGORIES.find(item => item.id === categoryId)
mountApp(root, previewDesktopApi, category ? { category: category.id, subpage: subpageId || category.subpages[0].id } : undefined)
