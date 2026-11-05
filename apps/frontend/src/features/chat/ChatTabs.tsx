import type { ChatTab } from './useChatTabs'
import { chatTabKey } from './useChatTabs'
import './chatTabs.css'

type Props = {
  tabs: ChatTab[]
  activeKey: string
  disabled: boolean
  language: 'zh-CN' | 'en-US'
  title: (tab: ChatTab) => string
  onSelect: (tab: ChatTab) => void
  onClose: (tab: ChatTab) => void
  onNew: () => void
}

export default function ChatTabs({ tabs, activeKey, disabled, language, title, onSelect, onClose, onNew }: Props) {
  return <nav className="chat-tabs" aria-label={language === 'zh-CN' ? '聊天标签' : 'Chat tabs'}>
    <div className="chat-tabs-list" role="tablist">
      {tabs.map(tab => {
        const key = chatTabKey(tab)
        const label = title(tab)
        return <div className="chat-tab" key={key}>
          <button type="button" role="tab" aria-selected={activeKey === key} title={`${tab.profile} · ${label}`}
            disabled={disabled} onClick={() => onSelect(tab)}>{label}</button>
          <button type="button" className="chat-tab-close" aria-label={`${language === 'zh-CN' ? '关闭标签' : 'Close tab'}: ${label}`}
            disabled={disabled} onClick={() => onClose(tab)}>×</button>
        </div>
      })}
    </div>
    <button type="button" className="chat-tab-new" aria-label={language === 'zh-CN' ? '新建聊天标签' : 'New chat tab'}
      title={language === 'zh-CN' ? '新建聊天' : 'New chat'} disabled={disabled} onClick={onNew}>＋</button>
  </nav>
}
