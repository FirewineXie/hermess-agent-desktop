import React from 'react'
import type { ChatTab } from './useChatTabs'
import { chatTabKey } from './useChatTabs'
import { chatTabsToClose, type ChatTabCloseMode, type ChatTabStatus } from './chatTabsState'
import './chatTabs.css'

type Props = {
  tabs: ChatTab[]
  activeKey: string
  disabled: boolean
  language: 'zh-CN' | 'en-US'
  title: (tab: ChatTab) => string
  status: (tab: ChatTab) => ChatTabStatus
  onSelect: (tab: ChatTab) => void
  onClose: (tab: ChatTab) => void
  onOpenWindow: (tab: ChatTab) => void
  onNew: () => void
  onCloseMany: (tabs: ChatTab[]) => void
}

export default function ChatTabs({ tabs, activeKey, disabled, language, title, status, onSelect, onClose, onOpenWindow, onNew, onCloseMany }: Props) {
  const menuRef = React.useRef<HTMLDetailsElement>(null)
  const zh = language === 'zh-CN'
  const statusLabels: Record<ChatTabStatus, string> = zh
    ? { new: '未开始', idle: '就绪', running: '正在运行', approval: '待审批', suggestion: '待建议', completed: '运行完成', failed: '运行失败', disconnected: '未连接' }
    : { new: 'New', idle: 'Ready', running: 'Running', approval: 'Approval needed', suggestion: 'Input needed', completed: 'Completed', failed: 'Failed', disconnected: 'Disconnected' }
  React.useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && menuRef.current) menuRef.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuRef.current?.open) {
        menuRef.current.open = false
        menuRef.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [])
  const modes: { mode: ChatTabCloseMode; label: string }[] = [
    { mode: 'others', label: zh ? '关闭其他标签' : 'Close other tabs' },
    { mode: 'idle', label: zh ? '关闭空闲标签' : 'Close idle tabs' },
    { mode: 'all', label: zh ? '关闭全部标签' : 'Close all tabs' },
  ]
  return <nav className="chat-tabs" aria-label={language === 'zh-CN' ? '聊天标签' : 'Chat tabs'}>
    <div className="chat-tabs-list" role="tablist">
      {tabs.map(tab => {
        const key = chatTabKey(tab)
        const label = title(tab)
        const state = status(tab)
        return <div className="chat-tab" key={key}>
          <button type="button" role="tab" aria-selected={activeKey === key} title={`${tab.profile} · ${label} · ${statusLabels[state]}`}
            disabled={disabled} onClick={() => onSelect(tab)}><span className="chat-tab-title">{label}</span><span className={`chat-tab-status ${state}`}>{statusLabels[state]}</span></button>
          {tab.id && <button type="button" className="chat-tab-window" aria-label={`${language === 'zh-CN' ? '在新窗口打开' : 'Open in new window'}: ${label}`}
            title={language === 'zh-CN' ? '在新窗口打开' : 'Open in new window'} disabled={disabled} onClick={() => onOpenWindow(tab)}>↗</button>}
          <button type="button" className="chat-tab-close" aria-label={`${language === 'zh-CN' ? '关闭标签' : 'Close tab'}: ${label}`}
            disabled={disabled || (!tab.id && tabs.length === 1)} onClick={() => onClose(tab)}>×</button>
        </div>
      })}
    </div>
    <button type="button" className="chat-tab-new" aria-label={language === 'zh-CN' ? '新建聊天标签' : 'New chat tab'}
      title={language === 'zh-CN' ? '新建聊天' : 'New chat'} disabled={disabled} onClick={onNew}>＋</button>
    <details className="chat-tabs-bulk" ref={menuRef}>
      <summary aria-label={zh ? '批量关闭聊天标签' : 'Close multiple chat tabs'}>{zh ? '批量关闭' : 'Close tabs'}</summary>
      <div className="chat-tabs-close-options">
        {modes.map(({ mode, label }) => {
          const targets = chatTabsToClose(tabs, activeKey, mode, status)
          return <button type="button" key={mode} disabled={disabled || !targets.length || (tabs.length === 1 && !tabs[0].id)} onClick={() => {
            if (menuRef.current) { menuRef.current.open = false; menuRef.current.querySelector('summary')?.focus() }
            onCloseMany(targets)
          }}>{label}</button>
        })}
        <small>{zh ? '只关闭标签，保留会话和运行任务。' : 'Sessions and running tasks are preserved.'}</small>
      </div>
    </details>
  </nav>
}
