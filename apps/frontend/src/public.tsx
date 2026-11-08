import React from 'react'
import ReactDOM, { type Root } from 'react-dom/client'
import type { DesktopApi } from '@hermess/contracts'
import App from './App'
import ChatWindowApp from './features/chat-window/ChatWindowApp'
import { DesktopProvider } from './app/DesktopContext'
import { LanguageProvider } from './i18n'

export function mountApp(element: HTMLElement, api: DesktopApi, onRenderError?: (error: unknown) => void): Root {
  const root = ReactDOM.createRoot(element, onRenderError ? { onUncaughtError: onRenderError } : undefined)
  root.render(<React.StrictMode><DesktopProvider api={api}><LanguageProvider><App /></LanguageProvider></DesktopProvider></React.StrictMode>)
  return root
}

export function mountChatWindow(element: HTMLElement, api: DesktopApi, onRenderError?: (error: unknown) => void): Root {
  const root = ReactDOM.createRoot(element, onRenderError ? { onUncaughtError: onRenderError } : undefined)
  root.render(<DesktopProvider api={api}><LanguageProvider><ChatWindowApp /></LanguageProvider></DesktopProvider>)
  return root
}

export { default as QuickInputView, type QuickInputApi } from './features/desktop/QuickInputView'
export { default as ComputerActivityView } from './features/desktop/ComputerActivityView'
