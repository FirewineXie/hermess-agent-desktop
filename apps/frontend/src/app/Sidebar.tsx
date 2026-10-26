import React from 'react'
import { useLanguage, translateApp } from '../i18n'
import type { ProfilesSnapshot } from '@hermess/contracts'
import type { SessionRow, View } from './types'
import { sessionSourceLabel } from '../features/chat/sessionSource'

type Props = {
  view: View
  open: boolean
  connected: boolean
  busy: boolean
  sessions: SessionRow[]
  sessionsState: 'loading' | 'ready' | 'error'
  activeSessionId: string
  onClose: () => void
  onOpenView: (view: View) => void
  onNewChat: () => void
  onRefreshSessions: () => void
  onResumeSession: (id: string) => void
  profiles: ProfilesSnapshot | null
  profileBusy: boolean
  profileError: string
  profilePendingRestart: boolean
  onSelectProfile: (name: string) => void
  onCreateProfile: (name: string) => void
  onRetryProfile: () => void
}

export default function Sidebar({ view, open, connected, busy, sessions, sessionsState, activeSessionId, onClose, onOpenView, onNewChat, onRefreshSessions, onResumeSession, profiles, profileBusy, profileError, profilePendingRestart, onSelectProfile, onCreateProfile, onRetryProfile }: Props) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const [pendingSessionId, setPendingSessionId] = React.useState<string | null>(null)
  const [creatingProfile, setCreatingProfile] = React.useState(false)
  const [profileName, setProfileName] = React.useState('')
  const zh = language === 'zh-CN'
  const servedProfiles = new Set(profiles?.gateways.flatMap(gateway => gateway.served_profiles || []) || [])
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
      <div className="profile-switcher">
        <label htmlFor="active-profile">{zh ? '当前 Profile' : 'Current profile'}</label>
        <select id="active-profile" value={profiles?.selected || 'default'} disabled={!connected || profileBusy || !profiles} onChange={event => onSelectProfile(event.target.value)}>
          {(profiles?.profiles || [{ name: 'default', is_default: true }]).map(profile => <option key={profile.name} value={profile.name} disabled={profile.name !== 'default' && !servedProfiles.has(profile.name)}>{profile.display_name || profile.name}{profile.name !== 'default' && !servedProfiles.has(profile.name) ? (zh ? '（等待启用）' : ' (not serving)') : ''}</option>)}
        </select>
        <button type="button" disabled={!connected || profileBusy} onClick={() => setCreatingProfile(value => !value)}>{zh ? '新建 Profile' : 'New profile'}</button>
        {creatingProfile && <form onSubmit={event => { event.preventDefault(); if (profileName.trim()) { onCreateProfile(profileName); setCreatingProfile(false); setProfileName('') } }}>
          <input value={profileName} onChange={event => setProfileName(event.target.value)} maxLength={64} placeholder={zh ? '例如 coder' : 'e.g. coder'} aria-label={zh ? 'Profile 名称' : 'Profile name'} />
          <button type="submit" disabled={!profileName.trim() || profileBusy}>{zh ? '创建' : 'Create'}</button>
        </form>}
        {profilePendingRestart && <div><small role="status">{zh ? '新 Profile 已创建，等待 Gateway 空闲后启用。' : 'Profile created; enable it when the Gateway is idle.'}</small><button type="button" disabled={profileBusy} onClick={onRetryProfile}>{zh ? '重试启用' : 'Retry'}</button></div>}
        {profileError && <small role="alert">{profileError}</small>}
      </div>
      <button className="new-chat" disabled={!connected || busy} onClick={onNewChat}>{t('ui.new.session')}</button>
      <nav className="primary-nav" aria-label={t('ui.features')}>
        <button className={view === 'chat' ? 'active' : ''} onClick={() => onOpenView('chat')}>◫ <span>{t('ui.chat')}</span></button>
        <button className={view === 'workspaces' ? 'active' : ''} onClick={() => onOpenView('workspaces')}>▣ <span>{t('ui.workspace.title')}</span></button>
        <button className={view === 'usage' ? 'active' : ''} onClick={() => onOpenView('usage')}>▥ <span>{t('ui.usage.title')}</span></button>
        <button className={view === 'model' ? 'active' : ''} onClick={() => onOpenView('model')}>◇ <span>{t('ui.model.settings')}</span></button>
        <button className={view === 'agent' ? 'active' : ''} onClick={() => onOpenView('agent')}>⚙ <span>{t('ui.agent.settings')}</span></button>
        <button className={view === 'profiles' ? 'active' : ''} onClick={() => onOpenView('profiles')}>◈ <span>{zh ? '角色与 Profile' : 'Roles and profiles'}</span></button>
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
        {connected && sessionsState === 'loading' && sessions.length === 0 && <p>{t('ui.sessions.loading')}</p>}
        {connected && sessionsState === 'error' && sessions.length === 0 && <p>{t('ui.sessions.failed')}</p>}
        {connected && sessionsState === 'ready' && sessions.length === 0 && <p>{t('ui.no.previous.sessions')}</p>}
        {connected && sessions.map(session => <button key={session.id}
          className={[view === 'chat' && session.id === activeSessionId ? 'active' : '', pendingSessionId === session.id ? 'pending' : ''].filter(Boolean).join(' ')}
          aria-busy={pendingSessionId === session.id}
          title={session.title || session.preview || session.id}
          onClick={() => selectSession(session.id)}>
          <span>▤</span><span className="session-title">{session.title || session.preview || session.id}</span>
          {sessionSourceLabel(session.source, language) && <span className="session-source">{sessionSourceLabel(session.source, language)}</span>}
        </button>)}
      </div>
      <div className="sidebar-footer"><span className={`status-dot ${connected ? 'ready' : ''}`} />
        <span>{connected ? t('ui.runtime.connected') : t('ui.runtime.not.started')}</span>
        <button onClick={() => onOpenView('runtime')}>{t('ui.manage')}</button>
      </div>
    </aside>
  </>
}
