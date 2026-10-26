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
  otherProfileSessions: Record<string, SessionRow[]>
  sessionsState: 'loading' | 'ready' | 'error'
  activeSessionId: string
  onClose: () => void
  onOpenView: (view: View) => void
  onNewChat: () => void
  onRefreshSessions: () => void
  onResumeSession: (profile: string, id: string) => void
  profiles: ProfilesSnapshot | null
  profileBusy: boolean
  profileError: string
  profilePendingRestart: boolean
  onSelectProfile: (name: string) => void
  onCreateProfile: (name: string) => void
  onRetryProfile: () => void
  onOpenProfile: (name: string) => void
}

export default function Sidebar({ view, open, connected, busy, sessions, otherProfileSessions, sessionsState, activeSessionId, onClose, onOpenView, onNewChat, onRefreshSessions, onResumeSession, profiles, profileBusy, profileError, profilePendingRestart, onSelectProfile, onCreateProfile, onRetryProfile, onOpenProfile }: Props) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const [pendingSession, setPendingSession] = React.useState<{ profile: string; id: string } | null>(null)
  const [creatingProfile, setCreatingProfile] = React.useState(false)
  const [profileName, setProfileName] = React.useState('')
  const zh = language === 'zh-CN'
  const servedProfiles = new Set(profiles?.gateways.flatMap(gateway => gateway.served_profiles || [gateway.profile]) || [])
  const hasAnySession = sessions.length > 0 || Object.values(otherProfileSessions).some(rows => rows.length > 0)
  React.useEffect(() => {
    if (!connected) {
      setPendingSession(null)
      return
    }
    if (!busy && pendingSession) {
      setPendingSession(null)
      onResumeSession(pendingSession.profile, pendingSession.id)
    }
  }, [busy, connected, pendingSession, onResumeSession])
  const selectSession = (profile: string, id: string) => {
    if (busy) setPendingSession({ profile, id })
    else { setPendingSession(null); onResumeSession(profile, id) }
  }
  return <>
    {open && <button className="sidebar-scrim" aria-label={t('ui.close.navigation')} onClick={onClose} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} aria-label={t('ui.main.navigation')}>
      <div className="brand"><span className="brand-mark">H</span><span>Hermess <small>Desktop</small></span></div>
      <nav className="primary-nav" aria-label={t('ui.features')}>
        <button onClick={onNewChat}><span>{t('ui.new.session')}</span></button>
        <button className={view === 'workspaces' ? 'active' : ''} onClick={() => onOpenView('workspaces')}>▣ <span>{t('ui.workspace.title')}</span></button>
        <button className={view === 'extensions' ? 'active' : ''} onClick={() => onOpenView('extensions')}>✦ <span>{zh ? '专家 · 技能 · 插件' : 'Experts · Skills · Plugins'}</span></button>
        <button className={view === 'scheduled' ? 'active' : ''} onClick={() => onOpenView('scheduled')}>◷ <span>{zh ? '定时任务' : 'Scheduled tasks'}</span></button>
        <details className="sidebar-more"><summary>{zh ? '更多功能' : 'More features'}</summary><div>
          <button className={view === 'usage' ? 'active' : ''} onClick={() => onOpenView('usage')}>▥ <span>{t('ui.usage.title')}</span></button>
          <button className={view === 'model' ? 'active' : ''} onClick={() => onOpenView('model')}>◇ <span>{t('ui.model.settings')}</span></button>
          <button className={view === 'agent' ? 'active' : ''} onClick={() => onOpenView('agent')}>⚙ <span>{t('ui.agent.settings')}</span></button>
          <button className={view === 'memory' ? 'active' : ''} onClick={() => onOpenView('memory')}>▤ <span>{t('ui.persona.and.memory')}</span></button>
          <button className={view === 'runtime' ? 'active' : ''} onClick={() => onOpenView('runtime')}>◉ <span>{t('ui.runtime.and.storage')}</span></button>
          <button className={view === 'tools' ? 'active' : ''} onClick={() => onOpenView('tools')}>▦ <span>{t('ui.tools.and.capabilities')}</span></button>
          <button className={view === 'channels' ? 'active' : ''} onClick={() => onOpenView('channels')}>◎ <span>{t('ui.channels')}</span></button>
          <button className={view === 'about' ? 'active' : ''} onClick={() => onOpenView('about')}>ⓘ <span>{t('ui.about')}</span></button>
        </div></details>
      </nav>
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
      <div className="sidebar-section-heading"><strong>PROFILES</strong><button disabled={!connected} onClick={onRefreshSessions} aria-label={t('ui.refresh.recent.conversations')}>↻</button></div>
      <div className="sidebar-sessions">
        {(profiles?.profiles || [{ name: 'default', is_default: true }]).map(profile => <div className="sidebar-profile-group" key={profile.name}>
          <button className={`sidebar-profile-row ${view === 'profiles' && profiles?.selected === profile.name ? 'active' : ''}`} disabled={!connected || profileBusy || !servedProfiles.has(profile.name)} onClick={() => onOpenProfile(profile.name)}>
            <span className="sidebar-profile-avatar" aria-hidden="true">{(profile.display_name || profile.name).slice(0, 1).toUpperCase()}</span>
            <span className="session-title">{profile.display_name || profile.name}</span>
            <span className={`profile-service-dot ${servedProfiles.has(profile.name) ? 'served' : ''}`} title={servedProfiles.has(profile.name) ? (zh ? 'Gateway 正在服务' : 'Served by Gateway') : (zh ? 'Gateway 未服务' : 'Not served by Gateway')} />
          </button>
          {connected && (profiles?.selected === profile.name ? sessions : otherProfileSessions[profile.name] || []).map(session => <button key={session.id}
            className={`sidebar-profile-session ${view === 'chat' && profiles?.selected === profile.name && session.id === activeSessionId ? 'active' : ''} ${pendingSession?.profile === profile.name && pendingSession.id === session.id ? 'pending' : ''}`}
            aria-busy={pendingSession?.profile === profile.name && pendingSession.id === session.id} title={session.title || session.preview || session.id}
            onClick={() => selectSession(profile.name, session.id)}><span aria-hidden="true">▤</span><span className="session-title">{session.title || session.preview || session.id}</span>{sessionSourceLabel(session.source, language) && <span className="session-source">{sessionSourceLabel(session.source, language)}</span>}</button>)}
        </div>)}
        {!connected && <p>{t('ui.show.history.sessions.after.starting.runtime')}</p>}
        {connected && sessionsState === 'loading' && sessions.length === 0 && <p>{t('ui.sessions.loading')}</p>}
        {connected && sessionsState === 'error' && sessions.length === 0 && <p>{t('ui.sessions.failed')}</p>}
        {connected && sessionsState === 'ready' && !hasAnySession && <p>{t('ui.no.previous.sessions')}</p>}
      </div>
      <div className="sidebar-footer"><span className={`status-dot ${connected ? 'ready' : ''}`} />
        <span>{connected ? t('ui.runtime.connected') : t('ui.runtime.not.started')}</span>
        <button onClick={() => onOpenView('runtime')}>{t('ui.manage')}</button>
      </div>
    </aside>
  </>
}
