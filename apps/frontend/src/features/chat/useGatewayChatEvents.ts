import React from 'react'
import type { DesktopApi, GatewayEvent, GatewayRequest } from '@hermess/contracts'
import { workspaceKey } from '../../app/profile-scope/ProfileWorkspace'

export function useGatewayChatEvents(
  events: DesktopApi['events'],
  epoch: React.MutableRefObject<string | undefined>,
  processors: React.MutableRefObject<Record<string, (data: GatewayEvent) => void>>,
  requests: React.MutableRefObject<Record<string, (data: GatewayRequest) => void>>,
  disconnects: React.MutableRefObject<Record<string, () => void>>,
  onSkillsChanged: () => void,
) {
  const skillsChanged = React.useRef(onSkillsChanged)
  skillsChanged.current = onSkillsChanged
  React.useEffect(() => {
    let active = true
    const subscriptions: Array<() => void> = []
    const subscribe = (result: Promise<() => void>) => { void result.then(stop => { if (active) subscriptions.push(stop); else stop() }) }
    subscribe(events.onGatewayEvent(data => {
      if (!active) return
      if (data.kind === 'skills.changed') skillsChanged.current()
      if (data.profile) processors.current[workspaceKey(epoch.current, data.profile)]?.(data)
    }))
    subscribe(events.onGatewayRequest(request => {
      if (active && request.profile) requests.current[workspaceKey(epoch.current, request.profile)]?.(request)
    }))
    subscribe(events.onDisconnect(() => {
      if (!active) return
      const prefix = `${epoch.current || 'offline'}\u0000`
      for (const [key, process] of Object.entries(disconnects.current)) if (key.startsWith(prefix)) process()
    }))
    return () => { active = false; subscriptions.forEach(stop => stop()) }
  }, [events, epoch, processors, requests, disconnects])
}
