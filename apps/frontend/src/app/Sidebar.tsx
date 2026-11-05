import React from 'react'
import { useLanguage, translateApp } from '../i18n'
import type { BotGroup, ProfilesSnapshot } from '@hermess/contracts'
import type { SessionRow, View } from './types'
import { sessionSourceLabel } from '../features/chat/sessionSource'
import type { SessionActivity } from '../features/chat/useSessionActivity'
import { describeError } from './desktopErrors'
import { DashboardPluginSlot, type DashboardPluginManifest } from '../features/dashboard-plugins/DashboardPluginHost'
import { achievementsPluginName, secondaryDashboardPluginTabs } from '../features/dashboard-plugins/dashboardRouteModel'
import './sidebar-session-actions.css'

type Props = {
  view: View
  open: boolean
  connected: boolean
  busy: boolean
  sessions: SessionRow[]
  otherProfileSessions: Record<string, SessionRow[]>
  groups: BotGroup[]
  groupsError: string
  activeGroupId: string | null
  sessionActivity: Record<string, SessionActivity>
  activityKey: (profile: string, id: string) => string
  sessionsState: 'loading' | 'ready' | 'error'
  activeSessionId: string
  onClose: () => void
  onOpenView: (view: View) => void
  onNewChat: () => void
  onNewGroup: () => void
  onOpenGroup: (roomId: string) => void
  onRefreshGroups: () => void
  onResumeSession: (profile: string, id: string) => void
  onArchiveSession: (profile: string, id: string) => Promise<void>
  onDeleteSession: (profile: string, id: string) => Promise<void>
  profiles: ProfilesSnapshot | null
  profileBusy: boolean
  profileError: string
  profilePendingRestart: boolean
  onRetryProfile: () => void
  onOpenProfile: (name: string) => void
  dashboardPlugins: DashboardPluginManifest[]
  activeDashboardPlugin: string | null
  onOpenDashboardPlugin: (name: string) => void
}

export default function Sidebar({ view, open, connected, busy, sessions, otherProfileSessions, groups, groupsError, activeGroupId, sessionActivity, activityKey, sessionsState, activeSessionId, onClose, onOpenView, onNewChat, onNewGroup, onOpenGroup, onRefreshGroups, onResumeSession, onArchiveSession, onDeleteSession, profiles, profileBusy, profileError, profilePendingRestart, onRetryProfile, onOpenProfile, dashboardPlugins, activeDashboardPlugin, onOpenDashboardPlugin }: Props) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const [pendingSession, setPendingSession] = React.useState<{ profile: string; id: string } | null>(null)
  const [expandedProfiles, setExpandedProfiles] = React.useState<Set<string>>(() => new Set())
  const [visibleSessionCounts, setVisibleSessionCounts] = React.useState<Record<string, number>>({})
  const [deleteTarget, setDeleteTarget] = React.useState<{ profile: string; session: SessionRow } | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState('')
  const [archiveBusy, setArchiveBusy] = React.useState<string | null>(null)
  const [archiveError, setArchiveError] = React.useState('')
  const [newMenuOpen, setNewMenuOpen] = React.useState(false)
  const [featuresOpen, setFeaturesOpen] = React.useState(false)
  const featuresRef = React.useRef<HTMLDivElement>(null)
  const featuresButtonRef = React.useRef<HTMLButtonElement>(null)
  const zh = language === 'zh-CN'
  const servedProfiles = new Set(profiles?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]) || [])
  const hasAnySession = groups.length > 0 || sessions.length > 0 || Object.values(otherProfileSessions).some(rows => rows.length > 0)
  React.useEffect(() => {
    setExpandedProfiles(new Set([profiles?.selected || 'default']))
  }, [profiles?.selected])
  React.useEffect(() => {
    if (!featuresOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!featuresRef.current?.contains(event.target as Node)) setFeaturesOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setFeaturesOpen(false); featuresButtonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [featuresOpen])
  React.useEffect(() => { setFeaturesOpen(false) }, [view, activeDashboardPlugin])
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
  const toggleProfileSessions = (name: string) => setExpandedProfiles(current => {
    const next = new Set(current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })
  const openFeatureView = (next: View) => { setFeaturesOpen(false); onOpenView(next) }
  const openFeaturePlugin = (name: string) => { setFeaturesOpen(false); onOpenDashboardPlugin(name) }
  const toggleMoreSessions = (name: string, total: number) => setVisibleSessionCounts(current => ({
    ...current,
    [name]: (current[name] || 5) >= total ? 5 : (current[name] || 5) + 5,
  }))
  const confirmDelete = async () => {
    if (!deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await onDeleteSession(deleteTarget.profile, deleteTarget.session.id)
      setDeleteTarget(null)
    } catch (cause) {
      setDeleteError(describeError(cause, language))
    } finally { setDeleteBusy(false) }
  }
  const archiveSession = async (profile: string, session: SessionRow) => {
    if (archiveBusy || busy || session.running) return
    const key = `${profile}:${session.id}`
    setArchiveBusy(key)
    setArchiveError('')
    try {
      await onArchiveSession(profile, session.id)
    } catch (cause) {
      setArchiveError(describeError(cause, language))
    } finally { setArchiveBusy(null) }
  }
  return <>
    {open && <button className="sidebar-scrim" aria-label={t('ui.close.navigation')} onClick={onClose} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} aria-label={t('ui.main.navigation')}>
      <div className="brand"><span className="brand-mark">H</span><span>Hermess <small>Desktop</small></span></div>
      <nav className="primary-nav" aria-label={zh ? '新建会话' : 'New conversation'}>
        <button aria-expanded={newMenuOpen} onClick={() => setNewMenuOpen(current => !current)}><span>{t('ui.new.session')}</span></button>
        {newMenuOpen && <div className="sidebar-new-menu"><button type="button" onClick={() => { setNewMenuOpen(false); onNewChat() }}>{zh ? '单独聊天' : 'One-to-one chat'}</button><button type="button" onClick={() => { setNewMenuOpen(false); onNewGroup() }}>{zh ? '多人群聊' : 'Group chat'}</button></div>}
      </nav>
      {profilePendingRestart && <div className="sidebar-profile-notice" role="status">{zh ? '新专家等待 Gateway 启用。' : 'New expert is waiting for Gateway.'} <button type="button" disabled={profileBusy} onClick={onRetryProfile}>{zh ? '重试' : 'Retry'}</button></div>}
      {profileError && <div className="sidebar-profile-notice" role="alert">{profileError}</div>}
      {archiveError && <div className="sidebar-profile-notice" role="alert">{archiveError}</div>}
      <div className="sidebar-sessions">
        {connected && (groups.length > 0 || groupsError) && <div className="sidebar-group-history"><div className="sidebar-section-heading"><strong>{zh ? '群聊' : 'GROUP CHATS'}</strong></div>
          {groupsError && <p role="alert">{groupsError} <button type="button" onClick={onRefreshGroups}>{zh ? '重试' : 'Retry'}</button></p>}
          {groups.map(group => <button type="button" key={group.room_id} className={`sidebar-profile-session ${view === 'chat' && activeGroupId === group.room_id ? 'active' : ''}`} title={group.name} onClick={() => onOpenGroup(group.room_id)}><span aria-hidden="true">◉</span><span className="session-title">{group.name}</span><span className="session-source">{group.members.length} Bot</span></button>)}
        </div>}
        <div className="sidebar-section-heading"><strong>PROFILES</strong></div>
        {(profiles?.profiles || [{ name: 'default', is_default: true }]).map(profile => {
          const profileSessions = profiles?.selected === profile.name ? sessions : otherProfileSessions[profile.name] || []
          const visibleCount = visibleSessionCounts[profile.name] || 5
          const allVisible = visibleCount >= profileSessions.length
          return <div className="sidebar-profile-group" key={profile.name}>
          <div className="sidebar-profile-heading"><button className={`sidebar-profile-row ${view === 'profiles' && profiles?.selected === profile.name ? 'active' : ''}`} aria-expanded={expandedProfiles.has(profile.name)} onClick={() => toggleProfileSessions(profile.name)}>
            <span className="sidebar-profile-avatar" aria-hidden="true">{(profile.display_name || profile.name).slice(0, 1).toUpperCase()}</span>
            <span className="session-title">{profile.display_name || profile.name}</span>
            {connected && profiles && !servedProfiles.has(profile.name) && <span className="profile-unserved" title={zh ? 'Gateway 尚未服务此 Profile' : 'Gateway is not serving this profile'}>{zh ? '待启用' : 'Unavailable'}</span>}
            <span className="sidebar-profile-chevron" aria-hidden="true">⌄</span>
          </button><button type="button" className="sidebar-profile-manage" disabled={!connected || profileBusy || !servedProfiles.has(profile.name)} aria-label={zh ? `管理 ${profile.display_name || profile.name}` : `Manage ${profile.display_name || profile.name}`} title={zh ? '管理专家' : 'Manage expert'} onClick={() => onOpenProfile(profile.name)}>⚙</button></div>
          {connected && expandedProfiles.has(profile.name) && profileSessions.slice(0, visibleCount).map(session => <div className="sidebar-session-entry" key={session.id}><button
            className={`sidebar-profile-session ${view === 'chat' && !activeGroupId && profiles?.selected === profile.name && session.id === activeSessionId ? 'active' : ''} ${pendingSession?.profile === profile.name && pendingSession.id === session.id ? 'pending' : ''}`}
            aria-busy={pendingSession?.profile === profile.name && pendingSession.id === session.id} title={session.title || session.preview || session.id}
            onClick={() => selectSession(profile.name, session.id)}><span aria-hidden="true">▤</span><span className="session-title">{session.title || session.preview || session.id}</span>{sessionActivity[activityKey(profile.name, session.id)] && <span className={`session-activity ${sessionActivity[activityKey(profile.name, session.id)]}`} role="status">{{ running: zh ? '正在运行' : 'Running', approval: zh ? '待审批' : 'Approval needed', suggestion: zh ? '待建议' : 'Input needed', completed: zh ? '运行完成' : 'Completed', failed: zh ? '运行失败' : 'Failed' }[sessionActivity[activityKey(profile.name, session.id)]]}</span>}{sessionSourceLabel(session.source, language) && <span className="session-source">{sessionSourceLabel(session.source, language)}</span>}</button><button type="button" className="sidebar-session-archive" disabled={busy || deleteBusy || archiveBusy !== null || session.running} aria-label={zh ? `归档会话 ${session.title || session.preview || session.id}` : `Archive session ${session.title || session.preview || session.id}`} title={session.running ? (zh ? '运行中的会话不能归档' : 'Running sessions cannot be archived') : (zh ? '归档会话' : 'Archive session')} onClick={() => void archiveSession(profile.name, session)}>{archiveBusy === `${profile.name}:${session.id}` ? '…' : '□'}</button><button type="button" className="sidebar-session-delete" disabled={busy || deleteBusy || archiveBusy !== null} aria-label={zh ? `删除会话 ${session.title || session.preview || session.id}` : `Delete session ${session.title || session.preview || session.id}`} title={zh ? '删除会话' : 'Delete session'} onClick={() => { setDeleteError(''); setDeleteTarget({ profile: profile.name, session }) }}>×</button></div>)}
          {connected && expandedProfiles.has(profile.name) && profileSessions.length > 5 && <button type="button" className="sidebar-profile-more" onClick={() => toggleMoreSessions(profile.name, profileSessions.length)}>{allVisible ? (zh ? '收起' : 'Show less') : (zh ? '展示更多' : 'Show more')}</button>}
        </div>})}
        {!connected && <p>{t('ui.show.history.sessions.after.starting.runtime')}</p>}
        {connected && sessionsState === 'loading' && sessions.length === 0 && <p>{t('ui.sessions.loading')}</p>}
        {connected && sessionsState === 'error' && sessions.length === 0 && <p>{t('ui.sessions.failed')}</p>}
        {connected && sessionsState === 'ready' && !hasAnySession && <p>{t('ui.no.previous.sessions')}</p>}
      </div>
      <div className="sidebar-feature-nav" ref={featuresRef}>
        <button ref={featuresButtonRef} type="button" className="sidebar-feature-trigger" aria-expanded={featuresOpen} aria-controls="sidebar-feature-menu" onClick={() => { setNewMenuOpen(false); setFeaturesOpen(current => !current) }}>{zh ? '功能' : 'Features'} <span aria-hidden="true">{featuresOpen ? '⌄' : '⌃'}</span></button>
        <nav id="sidebar-feature-menu" className="sidebar-feature-menu" aria-label={zh ? '功能导航' : 'Feature navigation'} hidden={!featuresOpen}>
          <span className="sidebar-feature-heading">{zh ? '聊天与文件' : 'Chat and files'}</span>
          <button className={view === 'bots' ? 'active' : ''} onClick={() => openFeatureView('bots')}>◉ <span>{zh ? 'Bot 模式' : 'Bot Mode'}</span></button>
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => openFeatureView('sessions')}>☷ <span>{zh ? '会话管理' : 'Sessions'}</span></button>
          <button className={view === 'files' ? 'active' : ''} onClick={() => openFeatureView('files')}>▣ <span>{zh ? '文件管理' : 'Files'}</span></button>
          <button className={view === 'workspaces' ? 'active' : ''} onClick={() => openFeatureView('workspaces')}>▣ <span>{t('ui.workspace.title')}</span></button>
          <span className="sidebar-feature-heading">{zh ? '任务与扩展' : 'Tasks and extensions'}</span>
          <button className={view === 'personal-tasks' ? 'active' : ''} onClick={() => openFeatureView('personal-tasks')}>▤ <span>{zh ? '持续任务' : 'Ongoing tasks'}</span></button>
          <button className={view === 'scheduled' ? 'active' : ''} onClick={() => openFeatureView('scheduled')}>◷ <span>{zh ? '定时任务' : 'Scheduled tasks'}</span></button>
          <button className={view === 'extensions' ? 'active' : ''} onClick={() => openFeatureView('extensions')}>✦ <span>{zh ? '扩展中心' : 'Extension Center'}</span></button>
          <button className={view === 'dashboard-plugin' && activeDashboardPlugin === achievementsPluginName ? 'active' : ''} onClick={() => openFeaturePlugin(achievementsPluginName)}>◇ <span>{zh ? '成就' : 'Achievements'}</span></button>
          {secondaryDashboardPluginTabs(dashboardPlugins).map(plugin => <button key={plugin.name} className={view === 'dashboard-plugin' && activeDashboardPlugin === plugin.name ? 'active' : ''} onClick={() => openFeaturePlugin(plugin.name)}>◇ <span>{plugin.label}</span></button>)}
          <button className={view === 'webhooks' ? 'active' : ''} onClick={() => openFeatureView('webhooks')}>⌁ <span>Webhooks</span></button>
          <button className={view === 'tools' ? 'active' : ''} onClick={() => openFeatureView('tools')}>▦ <span>{t('ui.tools.and.capabilities')}</span></button>
          <DashboardPluginSlot name="sidebar" />
        </nav>
      </div>
      <div className="sidebar-footer"><span className={`status-dot ${connected ? 'ready' : ''}`} />
        <span>{connected ? t('ui.runtime.connected') : t('ui.runtime.not.started')}</span>
        <button onClick={() => onOpenView('runtime')}>{t('ui.manage')}</button>
      </div>
    </aside>
    {deleteTarget && <div className="session-delete-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deleteBusy) setDeleteTarget(null) }}>
      <div className="session-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="session-delete-title" onKeyDown={event => { if (event.key === 'Escape' && !deleteBusy) setDeleteTarget(null) }}>
        <h2 id="session-delete-title">{zh ? '删除会话' : 'Delete session'}</h2>
        <p>{zh ? '将永久删除此会话的历史记录和转录文件，无法撤销。正在运行或等待处理的会话暂不能删除。' : 'This permanently deletes the session history and transcripts. Running or waiting sessions cannot be deleted.'}</p>
        <p><strong>{deleteTarget.session.title || deleteTarget.session.preview || deleteTarget.session.id}</strong></p>
        {deleteError && <p role="alert">{deleteError}</p>}
        <div className="session-delete-actions"><button type="button" autoFocus disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="confirm" disabled={deleteBusy} onClick={() => void confirmDelete()}>{deleteBusy ? (zh ? '正在删除…' : 'Deleting…') : (zh ? '确认删除' : 'Delete')}</button></div>
      </div>
    </div>}
  </>
}
