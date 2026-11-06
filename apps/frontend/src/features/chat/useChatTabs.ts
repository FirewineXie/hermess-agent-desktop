import React from 'react'

export type ChatTab = { profile: string; id: string }

export function chatTabKey(tab: ChatTab): string {
  return `${tab.profile}\u0000${tab.id}`
}

/** Tabs belong to this window. Sessions themselves remain in Gateway history. */
export function useChatTabs(profile: string | null, sessionId: string, storedId: string) {
  const [tabs, setTabs] = React.useState<ChatTab[]>([])
  const current = profile ? { profile, id: sessionId ? storedId : '' } : null
  const currentKey = current ? chatTabKey(current) : ''

  React.useEffect(() => {
    if (!current) return
    setTabs(previous => previous.some(tab => chatTabKey(tab) === currentKey) ? previous : [...previous, current])
  }, [currentKey])

  const close = React.useCallback((tab: ChatTab) => {
    setTabs(previous => previous.filter(item => chatTabKey(item) !== chatTabKey(tab)))
  }, [])

  return { tabs, currentKey, close }
}
