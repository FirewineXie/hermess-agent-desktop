import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useLanguage } from '../../i18n'

type Target = { profile: string; id: string }

export function usePersonalTaskEvents(connected: boolean, epoch: string | null, storage: string, profiles: ProfilesSnapshot | null, open: (target: Target) => void) {
  const { personalTasks, notifications } = useDesktop()
  const language = useLanguage()
  const openRef = React.useRef(open)
  openRef.current = open

  React.useEffect(() => {
    if (!connected || !epoch || !storage || !profiles) return
    let live = true
    let ticking = false
    let unsubscribe: (() => void) | undefined
    void notifications.onAction(action => {
      if (live && action.kind === 'open' && action.target.connectionId === epoch && action.target.taskId) {
        openRef.current({ profile: action.target.profile, id: action.target.taskId })
      }
    }).then(stop => { if (live) unsubscribe = stop; else stop() })

    const tick = async () => {
      if (ticking) return
      ticking = true
      try {
        const names = [...new Set(profiles.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]))]
        for (const profile of names) {
          const key = `hermess:personal-task-cursor:${storage}:${profile}`
          let cursor = Number(localStorage.getItem(key) || 0)
          if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0
          try {
            const batch = await personalTasks.events({ kind: 'profile', profile }, cursor)
            for (const event of batch.events) {
              if (!live) return
              if (['completed', 'blocked', 'gave_up', 'failed'].includes(event.kind)) {
                const result = await personalTasks.detail({ kind: 'profile', profile }, event.task_id)
                const title = result.task.title
                const body = result.task.summary || result.task.failure || event.kind
                await notifications.show(title, body, { connectionId: epoch, profile, sessionId: '', taskId: event.task_id, locale: language })
              }
              cursor = event.id
              localStorage.setItem(key, String(cursor))
            }
            if (live && Number.isSafeInteger(batch.next) && batch.next > cursor) {
              localStorage.setItem(key, String(batch.next))
            }
          } catch { /* Keep the durable cursor for retry when this Profile or notifier returns. */ }
        }
      } finally { ticking = false }
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, 5000)
    return () => { live = false; window.clearInterval(timer); unsubscribe?.() }
  }, [connected, epoch, storage, profiles, personalTasks, notifications, language])
}
