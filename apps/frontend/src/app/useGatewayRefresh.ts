import React from 'react'
import { useDesktop } from './DesktopContext'

export function useGatewayRefresh(connected: boolean, kind: string, refresh: () => void | Promise<void>) {
  const { events } = useDesktop()
  const current = React.useRef(refresh)
  current.current = refresh
  React.useEffect(() => {
    if (!connected) return
    let active = true
    let unlisten: (() => void) | undefined
    let timer: number | undefined
    void events.onGatewayEvent(event => {
      if (!active || event.kind !== kind || timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        if (active) void current.current()
      }, 250)
    }).then(stop => { if (active) unlisten = stop; else stop() }).catch(() => {})
    return () => {
      active = false
      window.clearTimeout(timer)
      unlisten?.()
    }
  }, [connected, kind, events])
}
