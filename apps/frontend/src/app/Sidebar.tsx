import React from 'react'
import { useLanguage, translateApp } from '../i18n'
import type { SessionRow, View } from './types'

type Props = {
  view: View
  open: boolean
  connected: boolean
  busy: boolean
  sessions: SessionRow[]
  activeSessionId: string
  onClose: () => void
  onOpenView: (view: View) => void
  onNewChat: () => void
  onRefreshSessions: () => void
  onResumeSession: (id: string) => void
}

export default function Sidebar({ view, open, connected, busy, sessions, activeSessionId, onClose, onOpenView, onNewChat, onRefreshSessions, onResumeSession }: Props) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const [pendingSessionId, setPendingSessionId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!connected) {
      setPendingSessionId(null)
      return
    }
    if (!busy && pendingSessionId) {
      setPendingSessionId(null)
      onResumeSession(pendingSessionId)
    }
  }, [busy, connected, pendingSessionId, onResumeSession])
  const selectSession = (id: string) => {
    if (busy) setPendingSessionId(id)
    else { setPendingSessionId(null); onResumeSession(id) }
  }
  return <>
    {open && <button className="sidebar-scrim" aria-label={t('ui.close.navigation')} onClick={onClose} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} aria-label={t('ui.main.navigation')}>
      <div className="brand"><span className="brand-mark">H</span><span>Hermess <small>Desktop</small></span></div>
      <button className="new-chat" disabled={!connected || busy} onClick={onNewChat}>{t('ui.new.session')}</button>
      <nav className="primary-nav" aria-label={t('ui.features')}>
        <button className={view === 'chat' ? 'active' : ''} onClick={() => onOpenView('chat')}>◫ <span>{t('ui.chat')}</span></button>
        <button className={view === 'model' ? 'active' : ''} onClick={() => onOpenView('model')}>◇ <span>{t('ui.model.settings')}</span></button>
        <button className={view === 'agent' ? 'active' : ''} onClick={() => onOpenView('agent')}>⚙ <span>{t('ui.agent.settings')}</span></button>
        <button className={view === 'memory' ? 'active' : ''} onClick={() => onOpenView('memory')}>▤ <span>{t('ui.persona.and.memory')}</span></button>
        <button className={view === 'runtime' ? 'active' : ''} onClick={() => onOpenView('runtime')}>◉ <span>{t('ui.runtime.and.storage')}</span></button>
        <button className={view === 'tools' ? 'active' : ''} onClick={() => onOpenView('tools')}>▦ <span>{t('ui.tools.and.capabilities')}</span></button>
        <button className={view === 'extensions' ? 'active' : ''} onClick={() => onOpenView('extensions')}>✦ <span>{t('ui.extensions')}</span></button>
        <button className={view === 'channels' ? 'active' : ''} onClick={() => onOpenView('channels')}>◎ <span>{t('ui.channels')}</span></button>
        <button className={view === 'about' ? 'active' : ''} onClick={() => onOpenView('about')}>ⓘ <span>{t('ui.about')}</span></button>
      </nav>
      <div className="sidebar-section-heading"><strong>{t('ui.recent.sessions')}</strong><button disabled={!connected} onClick={onRefreshSessions} aria-label={t('ui.refresh.recent.conversations')}>↻</button></div>
      <div className="sidebar-sessions">
        {!connected && <p>{t('ui.show.history.sessions.after.starting.runtime')}</p>}
        {connected && sessions.length === 0 && <p>{t('ui.no.previous.sessions')}</p>}
        {connected && sessions.map(session => <button key={session.id}
          className={[view === 'chat' && session.id === activeSessionId ? 'active' : '', pendingSessionId === session.id ? 'pending' : ''].filter(Boolean).join(' ')}
          aria-busy={pendingSessionId === session.id}
          title={session.title || session.preview || session.id}
          onClick={() => selectSession(session.id)}>
          <span>▤</span><span className="session-title">{session.title || session.preview || session.id}</span>
        </button>)}
      </div>
      <div className="sidebar-footer"><span className={`status-dot ${connected ? 'ready' : ''}`} />
        <span>{connected ? t('ui.runtime.connected') : t('ui.runtime.not.started')}</span>
        <button onClick={() => onOpenView('runtime')}>{t('ui.manage')}</button>
      </div>
    </aside>
  </>
}
