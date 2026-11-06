import React from 'react'
import type { MediaScope } from '@hermess/contracts'

const ChatMediaContext = React.createContext<MediaScope | null>(null)

export function ChatMediaProvider({ scope, children }: { scope: MediaScope | null; children: React.ReactNode }) {
  return <ChatMediaContext.Provider value={scope}>{children}</ChatMediaContext.Provider>
}

export function useChatMediaScope(): MediaScope | null { return React.useContext(ChatMediaContext) }
