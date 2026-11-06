import { mountChatWindow } from '@hermess/frontend'
import { chatWindowDesktopApi } from './adapter/chatWindowDesktopApi'
import { installWindowErrorLogging, recordClientError } from './adapter/errorLogging'

installWindowErrorLogging()
const root = document.getElementById('root')
if (!root) throw new Error('Chat window root is missing')
mountChatWindow(root, chatWindowDesktopApi, error => recordClientError('react_render_error', error))
