import type { SessionActivity } from './sessionActivityState'

export type ChatTab = { profile: string; id: string }
export type ChatTabStatus = SessionActivity | 'idle' | 'new' | 'disconnected'
export type ChatTabCloseMode = 'others' | 'idle' | 'all'

export function chatTabStatus(tab: ChatTab, connected: boolean, activity: SessionActivity | undefined,
  active: boolean, turnBusy: boolean, running: boolean): ChatTabStatus {
  if (!connected) return 'disconnected'
  if (activity === 'approval' || activity === 'suggestion') return activity
  if (active && turnBusy) return 'running'
  if (!tab.id) return 'new'
  return activity || (running ? 'running' : 'idle')
}

export function chatTabKey(tab: ChatTab): string {
  return `${tab.profile}\u0000${tab.id}`
}

export function registerChatTab(tabs: ChatTab[], current: ChatTab): ChatTab[] {
  const next = tabs.filter(tab => current.id || tab.id || tab.profile === current.profile)
  if (next.some(tab => chatTabKey(tab) === chatTabKey(current))) return next.length === tabs.length ? tabs : next
  return [...next, current]
}

export function removeChatTabs(tabs: ChatTab[], targets: ChatTab[], fallback?: ChatTab): ChatTab[] {
  const keys = new Set(targets.map(chatTabKey))
  const remaining = tabs.filter(tab => !keys.has(chatTabKey(tab)))
  return fallback ? registerChatTab(remaining, fallback) : remaining
}

export function chatTabsToClose(tabs: ChatTab[], activeKey: string, mode: ChatTabCloseMode,
  status: (tab: ChatTab) => ChatTabStatus): ChatTab[] {
  return tabs.filter(tab => mode === 'all' || (mode === 'others' ? chatTabKey(tab) !== activeKey
    : Boolean(tab.id) && ['idle', 'completed', 'failed'].includes(status(tab))))
}
