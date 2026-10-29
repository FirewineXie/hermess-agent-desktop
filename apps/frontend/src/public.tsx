import React from 'react'
import ReactDOM, { type Root } from 'react-dom/client'
import type { DesktopApi } from '@hermess/contracts'
import App from './App'
import { DesktopProvider } from './app/DesktopContext'
import { LanguageProvider } from './i18n'

export function mountApp(element: HTMLElement, api: DesktopApi): Root {
  const root = ReactDOM.createRoot(element)
  root.render(<React.StrictMode><DesktopProvider api={api}><LanguageProvider><App /></LanguageProvider></DesktopProvider></React.StrictMode>)
  return root
}

export { default as QuickInputView, type QuickInputApi } from './features/desktop/QuickInputView'
