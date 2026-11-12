import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useProfileRef } from '../../app/profile-scope/ProfileWorkspace'
import type { ChatControllerOptions } from './chatControllerOptions'
import { historyTimeline, type TimelineItem } from './timeline'

type Options = Pick<ChatControllerOptions, 'language' | 't'> & {
  workspace: string
  sessionRef: { current: string }
  sessionProfileRef: { current: string }
  assistantRef: { current: string }
  setConversation: React.Dispatch<React.SetStateAction<TimelineItem[]>>
  setAssistant: React.Dispatch<React.SetStateAction<string>>
  setChatStatus: React.Dispatch<React.SetStateAction<string>>
}

export function useExternalChannelTurns(options: Options) {
  const { chat } = useDesktop()
  const activeRef = useProfileRef<{ sessionId: string; profile: string; version: number } | null>(options.workspace, null)
  const versionRef = useProfileRef(options.workspace, 0)

  return {
    begin(sessionId: string, profile: string) {
      const startedAt = Date.now()
      const version = versionRef.current + 1
      versionRef.current = version
      activeRef.current = { sessionId, profile, version }
      return startedAt
    },
    complete(sessionId: string, profile: string) {
      const active = activeRef.current
      if (active?.sessionId !== sessionId || active.profile !== profile) return null
      activeRef.current = null
      return active.version
    },
    invalidate() {
      versionRef.current += 1
      activeRef.current = null
    },
    sync(sessionId: string, profile: string, version: number) {
      void chat.resumeSession({ kind: 'session', profile, sessionId }).then(snapshot => {
        if (options.sessionRef.current !== sessionId || options.sessionProfileRef.current !== profile
          || versionRef.current !== version) return
        options.setConversation(historyTimeline(snapshot.messages, Boolean(snapshot.running)))
        options.assistantRef.current = snapshot.inflight?.assistant || ''
        options.setAssistant(options.assistantRef.current)
      }).catch(cause => {
        if (options.sessionRef.current === sessionId && options.sessionProfileRef.current === profile
          && versionRef.current === version) {
          options.setChatStatus(options.t('ui.channel.message.sync.failed', describeError(cause, options.language)))
        }
      })
    },
  }
}
