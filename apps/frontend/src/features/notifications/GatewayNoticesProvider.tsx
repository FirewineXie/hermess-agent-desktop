import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { gatewayNotices, type GatewayNoticeAction, type GatewayNoticeItem } from './gatewayNotices'

const Context = React.createContext<{ items: GatewayNoticeItem[]; dispatch: React.Dispatch<GatewayNoticeAction> }>({
  items: [], dispatch: () => {},
})

export function useGatewayNotices() {
  return React.useContext(Context)
}

export default function GatewayNoticesProvider({ children }: { children: React.ReactNode }) {
  const { events } = useDesktop()
  const [items, dispatch] = React.useReducer(gatewayNotices, [])
  React.useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void events.onGatewayNotice(notice => {
      if (!active) return
      console.info('[gateway-notice] received', { gatewayId: notice.gatewayId, withdrawn: notice.text === null })
      dispatch({ type: 'receive', notice })
    }).then(stop => { if (active) unlisten = stop; else stop() })
      .catch(() => { if (active) console.warn('[gateway-notice] subscription failed') })
    return () => { active = false; unlisten?.() }
  }, [events])
  return <Context.Provider value={{ items, dispatch }}>{children}</Context.Provider>
}
