import React from 'react'
import ReactDOM, { type Root } from 'react-dom/client'
import type { DesktopApi } from '@hermess/contracts'
import App from './App'
import { DesktopProvider } from './app/DesktopContext'
import { LanguageProvider } from './i18n'
import type { SettingsLocation } from './features/settings/model'

export function mountApp(element: HTMLElement, api: DesktopApi, initialSettings?: SettingsLocation): Root {
  const root = ReactDOM.createRoot(element)
  root.render(<React.StrictMode><DesktopProvider api={api}><LanguageProvider><App initialSettings={initialSettings} /></LanguageProvider></DesktopProvider></React.StrictMode>)
  return root
}
