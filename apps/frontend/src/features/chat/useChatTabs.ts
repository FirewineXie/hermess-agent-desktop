import React from 'react'
import { chatTabKey, registerChatTab, removeChatTabs, type ChatTab } from './chatTabsState'
export { chatTabKey, type ChatTab } from './chatTabsState'

/** Tabs belong to this window. Sessions themselves remain in Gateway history. */
export function useChatTabs(profile: string | null, sessionId: string, storedId: string) {
  const [tabs, setTabs] = React.useState<ChatTab[]>([])
  const current = profile ? { profile, id: sessionId ? storedId : '' } : null
  const currentKey = current ? chatTabKey(current) : ''

  React.useEffect(() => {
    if (!current) return
    setTabs(previous => registerChatTab(previous, current))
  }, [currentKey])

  const close = React.useCallback((tab: ChatTab) => {
    setTabs(previous => previous.filter(item => chatTabKey(item) !== chatTabKey(tab)))
  }, [])

  const closeMany = React.useCallback((targets: ChatTab[], fallback?: ChatTab) => {
    setTabs(previous => removeChatTabs(previous, targets, fallback))
  }, [])

  return { tabs, currentKey, close, closeMany }
}
