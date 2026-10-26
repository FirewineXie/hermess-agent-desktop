import React from 'react'
import type { DesktopApi } from '@hermess/contracts'

const DesktopContext = React.createContext<DesktopApi | null>(null)

export function DesktopProvider({ api, children }: { api: DesktopApi; children: React.ReactNode }) {
  return <DesktopContext.Provider value={api}>{children}</DesktopContext.Provider>
}

export function useDesktop(): DesktopApi {
  const api = React.useContext(DesktopContext)
  if (!api) throw new Error('DesktopApi is missing')
  return api
}
