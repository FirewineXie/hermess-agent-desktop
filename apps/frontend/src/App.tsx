import React from 'react'
import './style.css'
import DeviceSettings from './features/desktop/DeviceSettings'
import { useQuickInputBridge } from './features/desktop/useQuickInputBridge'
import DelegationSettings from './features/models/DelegationSettings'
import './features/desktop/desktop-settings.css'
import ConfigurationSettings from './features/configuration/ConfigurationSettings'
import { isConfigurationPage } from './features/configuration/model'
import { useLanguage, translateApp } from './i18n'
import ToolsView from './features/tools/ToolsView'
import ExtensionsView from './features/extensions/ExtensionsView'
import ChatView from './features/chat/ChatView'
import ChatTabs from './features/chat/ChatTabs'
import BotsView from './features/bots/BotsView'
import { useChatController } from './features/chat/useChatController'
import { useChatTabs, chatTabKey, type ChatTab } from './features/chat/useChatTabs'
import { useSessionActivity } from './features/chat/useSessionActivity'
import ModelSettingsView from './features/models/ModelSettingsView'
import MainModelSettings from './features/models/MainModelSettings'
import MoaSettings from './features/models/MoaSettings'
import ModelRouteSettings from './features/agent-settings/ModelRouteSettings'
import MemoryContextSettings from './features/agent-settings/MemoryContextSettings'
import SettingsView from './features/settings/SettingsView'
import type { SettingsPage } from './features/settings/model'
import { useModelController } from './features/models/useModelController'
import RuntimeView from './features/runtime/RuntimeView'
import DiagnosticsView from './features/runtime/DiagnosticsView'
import ShellHooksSettings from './features/runtime/ShellHooksSettings'
import CuratorSettings from './features/runtime/CuratorSettings'
import SystemOperations from './features/runtime/SystemOperations'
import CredentialPoolSettings from './features/models/CredentialPoolSettings'
import PersonalFilesView from './features/personal-files/PersonalFilesView'
import AboutView from './features/about/AboutView'
import DocumentationView from './features/about/DocumentationView'
import UpdateView from './features/about/UpdateView'
import { useUpdateStatus } from './features/about/useUpdateStatus'
import ChannelsView from './features/channels/ChannelsView'
import UsageView from './features/usage/UsageView'
import JourneyView from './features/journey/JourneyView'
import WorkspacesView from './features/workspaces/WorkspacesView'
import { useWorkspaces } from './features/workspaces/useWorkspaces'
import { useRuntimeController } from './features/runtime/useRuntimeController'
import { useGatewayLanguage } from './features/runtime/useGatewayLanguage'
import { useProfiles } from './features/profiles/useProfiles'
import ProfilesView from './features/profiles/ProfilesView'
import Sidebar from './app/Sidebar'
import WorkspaceHeader from './app/WorkspaceHeader'
import WorkspacePanel from './features/workspace-panel/WorkspacePanel'
import ScheduledTasksView from './features/scheduled-tasks/ScheduledTasksView'
import KanbanBoardView from './features/personal-tasks/KanbanBoardView'
import WebhooksView from './features/webhooks/WebhooksView'
import PairingView from './features/pairing/PairingView'
import LogsView from './features/logs/LogsView'
import EnvKeysView from './features/env-keys/EnvKeysView'
import SessionsView from './features/session-management/SessionsView'
import FilesView from './features/managed-files/FilesView'
import { usePersonalTaskEvents } from './features/personal-tasks/usePersonalTaskEvents'
import type { View } from './app/types'
import type { ModelPick } from './features/models/model'
import type { SessionRow } from '@hermess/contracts'
import type { ActiveGateway } from '@hermess/contracts'
import BotGroupConversation from './features/bots/BotGroupConversation'
import { useGroupRooms } from './features/bots/useGroupRooms'
import { useDesktop } from './app/DesktopContext'
import { useProfileState, workspaceKey } from './app/profile-scope/ProfileWorkspace'
import NotificationsSettings from './features/notifications/NotificationsSettings'
import { useNativeNotifications } from './features/notifications/useNativeNotifications'
import { DashboardPluginPage, DashboardPluginSlot, useDashboardPlugins } from './features/dashboard-plugins/DashboardPluginHost'
import { dashboardBuiltinRoute, dashboardPageSlot, dashboardPluginForRoute, normalizeDashboardRoute } from './features/dashboard-plugins/dashboardRouteModel'
import type { ProfileTab } from './features/profiles/ProfileOverview'
import { describeError } from './app/desktopErrors'
import CommandPalette, { useCommandPalette } from './features/command-palette/CommandPalette'
import { paletteItems, type PaletteItem } from './features/command-palette/model'
import OnboardingDialog from './features/onboarding/OnboardingDialog'
import { useOnboarding } from './features/onboarding/useOnboarding'

function WorkspaceApp({ gateway, onRemote, onLocal }: { gateway: ActiveGateway; onRemote: () => void; onLocal: () => void }) {
  const remoteMode = gateway.mode === 'remote'
  const { chat, events, extensions, windowChrome, chatWindows } = useDesktop()
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(languageRef.current, key, ...values), [])
  const [view, setView] = React.useState<View>('chat')
  const [personalTaskTarget, setPersonalTaskTarget] = React.useState<{ profile: string; id: string } | null>(null)
  const [activeDashboardPlugin, setActiveDashboardPlugin] = React.useState<string | null>(null)
  const [dashboardRouteRequest, setDashboardRouteRequest] = React.useState<string | null>(() => normalizeDashboardRoute(window.location.pathname))
  const [settingsPage, setSettingsPage] = React.useState<SettingsPage>('providers')
  const [settingsReturnView, setSettingsReturnView] = React.useState<View>('chat')
  const [settingsDirty, setSettingsDirty] = React.useState(false)
  const [settingsBusy, setSettingsBusy] = React.useState(false)
  const [personalFilesDirty, setPersonalFilesDirty] = React.useState(false)
  const [profileMemoryOpen, setProfileMemoryOpen] = React.useState(false)
  const [profileFilesInitialTab, setProfileFilesInitialTab] = React.useState<'soul' | 'memory'>('memory')
  const [profileTab, setProfileTab] = React.useState<ProfileTab>('overview')
  const [profileTabRequest, setProfileTabRequest] = React.useState<{ id: number; tab: ProfileTab }>({ id: 0, tab: 'overview' })
  const [profileCreateOpen, setProfileCreateOpen] = React.useState(false)
  const [pendingLearnCommand, setPendingLearnCommand] = React.useState('')
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [activeGroupId, setActiveGroupId] = React.useState<string | null>(null)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [diagnosticsUnlocked, setDiagnosticsUnlocked] = React.useState(false)
  const updateStatus = useUpdateStatus()
  const workspaces = useWorkspaces()
  const {
    pythonPath, setPythonPath, storagePath, setStoragePath, storageLocked, freshInstallation,
    backend, setBackend, workspaceGeneration, backendStatus, setBackendStatus, busy, setBusy,
    startBackend, startBackendStrict, chooseStoragePath, pingBackend, stopBackend, stopBackendStrict,
    restartBackend, forceRestartBackend,
  } = useRuntimeController({
    t,
    onReset: () => { setActiveModel(null); resetChat(); resetModel() },
    gateway,
  })
  const onboarding = useOnboarding(freshInstallation, storagePath)
  const commandPalette = useCommandPalette(!onboarding.visible)
  const profileController = useProfiles({
    connected: Boolean(backend),
    backendEpoch: backend?.replay_epoch || null,
    restart: () => restartBackend(),
  })
  const viewedProfile = profileController.snapshot?.selected || null
  const groupRooms = useGroupRooms(Boolean(backend), backend?.replay_epoch || null, language)
  const dashboardPluginLifecycle = React.useMemo(() => ({ start: startBackendStrict, stop: stopBackendStrict, restart: restartBackend }), [startBackendStrict, stopBackendStrict, restartBackend])
  const dashboardPlugins = useDashboardPlugins(Boolean(backend) && !remoteMode, viewedProfile, backend?.replay_epoch || null, language, dashboardPluginLifecycle)
  const dashboardManifest = dashboardPlugins.manifests.find(plugin => plugin.name === activeDashboardPlugin) || null
  const dashboardRoutePath = dashboardBuiltinRoute({ view, settingsPage, profileTab, profileCreateOpen })
  const dashboardOverride = dashboardRoutePath ? dashboardPlugins.manifests.find(plugin => plugin.tab.override === dashboardRoutePath) || null : null
  const dashboardSlotPage = dashboardOverride ? null : dashboardPageSlot(dashboardRoutePath)
  useGatewayLanguage({
    profiles: remoteMode ? [] : profileController.snapshot?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]) || [],
    epoch: backend?.replay_epoch || null,
    language,
    storagePath,
    restart: restartBackend,
    reportError: setBackendStatus,
  })
  const [activeModel, setActiveModel] = useProfileState<ModelPick | null>(workspaceKey(backend?.replay_epoch, viewedProfile), null, 'app:active-model')
  const commandFinishedRef = React.useRef<(profile: string, sessionId: string) => void>(() => {})
  const chatController = useChatController({
    backend, remoteMode, profile: viewedProfile, chatVisible: view === 'chat' && !activeGroupId && !dashboardOverride, activeModel, language, storagePath, workspacePath: remoteMode ? '' : workspaces.selected, t,
    openChat: () => { if (openView('chat')) setActiveGroupId(null) }, openModelSettings: () => { openSettings('main') }, setSidebarOpen, setActiveModel,
    onCommandFinished: (owner, id) => commandFinishedRef.current(owner, id),
    onBackgroundStarted: () => setPanelOpen(true),
    openCommandPage: name => {
      if (name === 'toolsets' || name === 'skills' || name === 'plugins' || name === 'mcp') {
        if (!openView('profiles')) return false
        const tab: ProfileTab = name === 'toolsets' ? 'tools' : name
        setProfileTab(tab)
        setProfileCreateOpen(false)
        setProfileTabRequest(current => ({ id: current.id + 1, tab }))
        return true
      }
      if (name === 'journey') return openView('journey')
      return name === 'config' ? openSettings('advanced-config') : name === 'cron' ? openView('scheduled') : openSettings('local-tools')
    },
    setModelPickerOpen: value => modelController.setModelPickerOpen(value),
    setBackend, setBackendStatus, setBusy,
  })
  const {
    sessionId, sessionRef, sessionProfileRef, storedSessionRef, setChatStatus, turnBusy, navigationBusy, sessionCreating, reasoningBusy, sessions, sessionsState, serverRequests,
    attachmentBusy, loadSessions, newChat, resumeSession,
    reconnectBackend, resetChat,
  } = chatController
  const chatTabs = useChatTabs(viewedProfile, sessionId, storedSessionRef.current)
  const sendMessageRef = React.useRef(chatController.sendMessage)
  sendMessageRef.current = chatController.sendMessage
  React.useEffect(() => {
    if (!pendingLearnCommand || view !== 'chat') return
    const command = pendingLearnCommand
    setPendingLearnCommand('')
    void sendMessageRef.current(command, true)
  }, [pendingLearnCommand, view])
  const modelController = useModelController({ backend, profile: viewedProfile, storagePath, t, sessionRef, sessionProfileRef, turnBusy, setChatStatus, setActiveModel })
  const {
    savedModel, modelPickerOpen, setModelPickerOpen, modelButtonRef, modelPickerRef,
    pickerPosition, pickerProviders, pickerProvider, setPickerProvider, pickerModelInput,
    setPickerModelInput, pickerBusy, pickerError, pickerConfirmation, pickerModels,
    loadModelOptions, openModelPicker, pickModel, resetModel, modelOptionsLoaded,
  } = modelController
  React.useEffect(() => {
    if (!backend || !viewedProfile) return
    if (sessionsState !== 'ready') void loadSessions(true, viewedProfile)
    if (!remoteMode && !modelOptionsLoaded) void loadModelOptions()
  }, [backend, viewedProfile])
  const openView = (next: View): boolean => {
    if (next === view) { setSidebarOpen(false); return true }
    if (view === 'settings' && next !== 'settings' && settingsBusy) return false
    if (view === 'settings' && next !== 'settings' && settingsDirty && !window.confirm(t('ui.you.have.unsaved.settings.discard.changes'))) return false
    if (view === 'settings' && next !== 'settings') modelController.discardSettingsDraft()
    if ((view === 'memory' || (view === 'profiles' && profileMemoryOpen)) && next !== view && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return false
    if (next !== 'memory') setPersonalFilesDirty(false)
    if (next !== 'profiles') {
      setProfileMemoryOpen(false)
      setProfileCreateOpen(false)
    }
    if (next !== 'dashboard-plugin') setDashboardRouteRequest(null)
    setView(next)
    setSidebarOpen(false)
    return true
  }
  const openNewChat = async (): Promise<boolean> => {
    if (!openView('chat') || !viewedProfile || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy) return false
    setActiveGroupId(null)
    if (!sessionId && !storedSessionRef.current) return true
    const restoreBlank = chatTabs.tabs.some(tab => tab.profile === viewedProfile && !tab.id)
    await newChat(true, false, restoreBlank)
    return !storedSessionRef.current
  }
  React.useEffect(() => {
    const activateLocation = () => setDashboardRouteRequest(normalizeDashboardRoute(window.location.pathname))
    window.addEventListener('popstate', activateLocation)
    return () => window.removeEventListener('popstate', activateLocation)
  }, [])
  React.useEffect(() => {
    if (!dashboardRouteRequest) return
    const plugin = dashboardPluginForRoute(dashboardPlugins.manifests, dashboardRouteRequest)
    if (!plugin || !openView('dashboard-plugin')) return
    setActiveDashboardPlugin(plugin.name)
  }, [dashboardRouteRequest, dashboardPlugins.manifests])
  const openSettings = (page: SettingsPage = 'providers') => {
    if (view === 'settings' && page === settingsPage) return true
    if (view !== 'settings') {
      if (!openView('settings')) return false
      setSettingsReturnView(view)
    } else if (page !== settingsPage && settingsBusy) return false
    else if (settingsDirty && page !== settingsPage && !window.confirm(t('ui.you.have.unsaved.settings.discard.changes'))) return false
    if (page !== settingsPage) modelController.discardSettingsDraft()
    setSettingsDirty(false)
    setSettingsPage(page)
    setSidebarOpen(false)
    return true
  }
  const openDiagnostics = () => {
    if (openSettings('diagnostics')) setDiagnosticsUnlocked(true)
  }
  const learnSkill = async (command: string) => {
    if (!command || !openView('chat')) return
    setActiveGroupId(null)
    await newChat(false)
    setPendingLearnCommand(command)
  }
  useQuickInputBridge({
    target: !remoteMode && backend && viewedProfile ? { profile: viewedProfile, sessionId: storedSessionRef.current || '', epoch: backend.replay_epoch, busy: turnBusy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || settingsBusy || settingsDirty || personalFilesDirty || Boolean(chatController.draft.trim()) || chatController.attachments.length > 0 } : null,
    send: async text => { if (!openView('chat')) return false; setActiveGroupId(null); return Boolean(await chatController.sendMessage(text, true)) },
  })
  const activeSession = sessions.find(session => session.id === storedSessionRef.current)
  const [otherProfileSessions, setOtherProfileSessions] = useProfileState<Record<string, SessionRow[]>>(workspaceKey(backend?.replay_epoch, 'sidebar-other'), {}, 'app:other-profile-sessions')
  const otherSessionsVersion = React.useRef(0)
  const [pendingSession, setPendingSession] = React.useState<ChatTab | null>(null)
  const servedProfileNames = profileController.snapshot?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]).filter(name => name !== profileController.snapshot?.selected).join('|') || ''
  const refreshOtherProfileSessions = async () => {
    const version = ++otherSessionsVersion.current
    const names = [...new Set(servedProfileNames.split('|').filter(Boolean))]
    const results = await Promise.allSettled(names.map(name => chat.listSessions({ kind: 'profile', profile: name })))
    if (version === otherSessionsVersion.current) {
      setOtherProfileSessions(current => Object.fromEntries(results.map((result, index) => [
        names[index], result.status === 'fulfilled' ? result.value.sessions : current[names[index]] || [],
      ])))
    }
  }
  React.useEffect(() => {
    const version = ++otherSessionsVersion.current
    if (!backend || !servedProfileNames) { setOtherProfileSessions({}); return }
    const names = [...new Set(servedProfileNames.split('|'))]
    void Promise.allSettled(names.map(name => chat.listSessions({ kind: 'profile', profile: name }))).then(results => {
      if (version !== otherSessionsVersion.current) return
      setOtherProfileSessions(Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value.sessions : []])))
    })
    return () => { ++otherSessionsVersion.current }
  }, [backend?.replay_epoch, servedProfileNames, chat])
  const refreshSessionActivity = React.useCallback(() => {
    void loadSessions(true)
    void refreshOtherProfileSessions()
  }, [loadSessions, servedProfileNames, chat])
  const refreshSessionActivityRef = React.useRef(refreshSessionActivity)
  refreshSessionActivityRef.current = refreshSessionActivity
  React.useEffect(() => {
    if (!backend) return
    let active = true
    let unlisten: (() => void) | undefined
    const refreshVisibleSessions = () => {
      if (document.visibilityState === 'visible') refreshSessionActivityRef.current()
    }
    void events.onGatewayEvent(event => {
      if (active && event.kind === 'sessions.changed') refreshVisibleSessions()
    }).then(stop => { if (active) unlisten = stop; else stop() }).catch(() => {})
    window.addEventListener('focus', refreshVisibleSessions)
    document.addEventListener('visibilitychange', refreshVisibleSessions)
    return () => {
      active = false
      unlisten?.()
      window.removeEventListener('focus', refreshVisibleSessions)
      document.removeEventListener('visibilitychange', refreshVisibleSessions)
    }
  }, [backend?.replay_epoch, events])
  const { activity: sessionActivity, markViewed, settleCommand, keyFor: activityKey } = useSessionActivity(
    storagePath, backend?.replay_epoch || null, viewedProfile, sessions, otherProfileSessions,
    storedSessionRef.current, sessionId, serverRequests, view === 'chat' && !activeGroupId, turnBusy, refreshSessionActivity,
  )
  commandFinishedRef.current = settleCommand
  const openProfileSession = async (profile: string, id: string) => {
    if (!openView('chat')) return false
    setActiveGroupId(null)
    if (profile === viewedProfile && id === storedSessionRef.current) { markViewed(profile, id); return true }
    try {
      if (profileController.snapshot?.selected !== profile) await profileController.select(profile)
      setPendingSession({ profile, id })
      return true
    } catch { return false /* useProfiles reports selection errors in the sidebar */ }
  }
  const openGroup = (roomId: string) => {
    if (!openView('chat')) return
    setActiveGroupId(roomId)
  }
  const selectChatTab = async (tab: ChatTab): Promise<boolean> => {
    if (chatTabKey(tab) === chatTabs.currentKey) return true
    if (tab.id) return openProfileSession(tab.profile, tab.id)
    if (!openView('chat')) return false
    try {
      if (profileController.snapshot?.selected !== tab.profile) await profileController.select(tab.profile)
      setPendingSession(tab)
      return true
    } catch { return false /* Profile selection reports its own error. */ }
  }
  const closeChatTab = async (tab: ChatTab) => {
    const remaining = chatTabs.tabs.filter(item => chatTabKey(item) !== chatTabKey(tab))
    if (chatTabKey(tab) === chatTabs.currentKey) {
      const next = remaining.find(item => item.profile === tab.profile) || remaining.at(-1)
      if (next && next.profile !== tab.profile) {
        if (!await selectChatTab(next)) return
        chatTabs.close(tab)
        return
      } else if (next?.id) {
        if (!await resumeSession(next.id, false, backend?.replay_epoch || '', next.profile)) return
      } else if (next) await newChat(true, false, true)
      else if (tab.id) await newChat(false)
      else return
      if (storedSessionRef.current === tab.id) return
    }
    chatTabs.close(tab)
  }
  const deleteProfileSession = async (profile: string, id: string) => {
    await chatController.deleteSession(profile, id)
    if (profile !== viewedProfile) await refreshOtherProfileSessions()
  }
  const archiveProfileSession = async (profile: string, id: string) => {
    await extensions.request({ kind: 'profile', profile }, 'sessionManagement.archive', { id, archived: true })
    if (profile === viewedProfile) await loadSessions(true, profile)
    else await refreshOtherProfileSessions()
  }
  useNativeNotifications({
    connectionId: backend?.replay_epoch || null,
    activeTarget: view === 'chat' && viewedProfile && sessionId ? { profile: viewedProfile, sessionId } : undefined,
    language,
    onOpenSession: async (profile, id) => { await openProfileSession(profile, id) },
  })
  usePersonalTaskEvents(Boolean(backend) && !remoteMode, backend?.replay_epoch || null, storagePath || '', profileController.snapshot, target => {
    setPersonalTaskTarget(target)
    openView('personal-tasks')
  })
  React.useEffect(() => {
    if (!pendingSession || pendingSession.profile !== viewedProfile) return
    if (pendingSession.id) {
      void resumeSession(pendingSession.id, false, backend?.replay_epoch || '', pendingSession.profile).then(opened => {
        if (opened) markViewed(pendingSession.profile, pendingSession.id)
      })
    } else void newChat(true, false, true)
    setPendingSession(null)
  }, [pendingSession, viewedProfile])
  const restartForChannel = async (force = false) => {
    const restarted = force ? await forceRestartBackend() : await restartBackend()
    return Boolean(restarted)
  }
  const allCommandItems = paletteItems({
    language, connected: Boolean(backend), diagnosticsUnlocked, selectedProfile: viewedProfile,
    sessions, otherProfileSessions, dashboardPlugins: dashboardPlugins.manifests,
    profileNames: Object.fromEntries((profileController.snapshot?.profiles || []).map(profile => [profile.name, profile.display_name || profile.name])),
  })
  const commandItems = remoteMode ? allCommandItems.filter(item => item.target.kind === 'session'
    || item.target.kind === 'action'
    || (item.target.kind === 'page' && item.target.view === 'chat')) : allCommandItems
  const executeCommand = async (item: PaletteItem): Promise<boolean> => {
    const target = item.target
    if (remoteMode && target.kind === 'page' && target.view !== 'chat') return false
    if (remoteMode && (target.kind === 'setting' || target.kind === 'plugin')) return false
    if (target.kind === 'page') {
      if (target.view === 'personal-tasks') setPersonalTaskTarget(null)
      return openView(target.view)
    }
    if (target.kind === 'setting') return openSettings(target.page)
    if (target.kind === 'plugin') {
      if (!openView('dashboard-plugin')) return false
      setActiveDashboardPlugin(target.name)
      return true
    }
    if (target.kind === 'session') return openProfileSession(target.profile, target.id)
    if (target.id === 'new-chat') return openNewChat()
    if (!backend) return false
    await Promise.all([loadSessions(true), refreshOtherProfileSessions()])
    return true
  }
  return <div className={`app-shell ${windowChrome.customTitlebar ? 'custom-titlebar-shell' : ''} ${view === 'profiles' ? 'profile-page-shell' : ''} ${view === 'settings' ? 'settings-shell' : ''}`}>
    <div className="dashboard-plugin-backdrop" aria-hidden="true"><DashboardPluginSlot name="backdrop" /></div>
    <WorkspaceHeader view={view} sessionTitle={activeGroupId ? groupRooms.rooms.find(room => room.room_id === activeGroupId)?.name : activeSession?.title} sessionSource={activeGroupId ? undefined : activeSession?.source} pluginTitle={dashboardManifest?.label} connected={Boolean(backend)} gateway={gateway} updateVersion={updateStatus.candidate?.asset ? updateStatus.candidate.version : null} onOpenNavigation={() => setSidebarOpen(true)} onOpenView={next => { if (next === 'settings' && !remoteMode) openSettings(); else if (!remoteMode) { if (next === 'personal-tasks') setPersonalTaskTarget(null); openView(next) } }} onOpenUpdate={() => { if (!remoteMode) openSettings('update') }} onOpenCommandPalette={commandPalette.show} onSwitchRemote={onRemote} onSwitchLocal={onLocal} />
    <CommandPalette open={commandPalette.open} language={language} items={commandItems} onClose={commandPalette.close} onExecute={executeCommand} />
    <DashboardPluginSlot name="header-banner" />
    {view !== 'settings' && <Sidebar view={view} open={sidebarOpen} connected={Boolean(backend)} remoteMode={remoteMode} busy={navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} sessions={sessions} otherProfileSessions={otherProfileSessions} groups={groupRooms.rooms} groupsError={groupRooms.error} activeGroupId={activeGroupId} sessionActivity={sessionActivity} activityKey={activityKey} sessionsState={sessionsState} activeSessionId={storedSessionRef.current} onClose={() => setSidebarOpen(false)} onOpenView={next => { if (remoteMode) { if (next === 'bots' || next === 'sessions' || next === 'chat') openView(next) } else if (next === 'runtime') openSettings('runtime'); else if (next === 'about') openSettings('about'); else { if (next === 'personal-tasks') setPersonalTaskTarget(null); openView(next) } }} onNewChat={() => { void openNewChat() }} onNewGroup={() => { openView('bots') }} onOpenGroup={openGroup} onRefreshGroups={() => { void groupRooms.refresh() }} onResumeSession={(profile, id) => { void openProfileSession(profile, id) }} onArchiveSession={archiveProfileSession} onDeleteSession={deleteProfileSession}
      profiles={profileController.snapshot} profileBusy={profileController.busy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} profileError={profileController.error} profilePendingRestart={profileController.pendingRestart}
      onRetryProfile={() => void profileController.retryPending()}
      onOpenProfile={name => {
        setProfileTab('overview')
        setProfileCreateOpen(false)
        setProfileTabRequest(current => ({ id: current.id + 1, tab: 'overview' }))
        if (openView('profiles') && profileController.snapshot?.selected !== name) void profileController.select(name).catch(() => {})
      }} dashboardPlugins={dashboardPlugins.manifests} activeDashboardPlugin={activeDashboardPlugin} onOpenDashboardPlugin={name => { setActiveDashboardPlugin(name); openView('dashboard-plugin') }} />}
    <main className="workspace">
    <DashboardPluginSlot name="pre-main" />
    {dashboardSlotPage && <DashboardPluginSlot name={`${dashboardSlotPage}:top`} />}
    {dashboardOverride ? <DashboardPluginPage manifest={dashboardOverride} component={dashboardPlugins.components.get(dashboardOverride.name)} error={dashboardPlugins.error} /> : <>
    {view === 'bots' && <BotsView active={view === 'bots'} connected={Boolean(backend)} language={language} gatewayMode={remoteMode ? 'remote' : 'local'} onOpenChat={(profile, id) => { void openProfileSession(profile, id) }} onOpenGroup={openGroup} onGroupsChanged={() => { void groupRooms.refresh() }} onOpenProfiles={() => { if (!remoteMode) openView('profiles') }} />}
    {view === 'files' && <FilesView connected={Boolean(backend)} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} initialRoot={workspaces.selected} onSelectProfile={name => profileController.select(name)} />}
    {view === 'workspaces' && <WorkspacesView connected={Boolean(backend)} busy={navigationBusy || sessionCreating || turnBusy || attachmentBusy || reasoningBusy || pickerBusy}
      paths={workspaces.paths} selected={workspaces.selected} onAdd={workspaces.add} onSelect={workspaces.select} onRemove={workspaces.remove}
      onNewChat={path => { if (openView('chat')) { workspaces.select(path); void openNewChat() } }} />}
    {view === 'scheduled' && <ScheduledTasksView key={workspaceGeneration} connected={Boolean(backend)} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot} />}
    {view === 'personal-tasks' && <KanbanBoardView initialTaskId={personalTaskTarget?.id} connectionId={backend?.replay_epoch || null} />}
    {view === 'dashboard-plugin' && <DashboardPluginPage manifest={dashboardManifest} component={activeDashboardPlugin ? dashboardPlugins.components.get(activeDashboardPlugin) : undefined} error={dashboardPlugins.error} />}
    {view === 'webhooks' && <WebhooksView connected={Boolean(backend)} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} onRestart={() => restartBackend().then(Boolean)} />}
    {view === 'usage' && <UsageView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onOpenConfiguration={() => openSettings('advanced-config')} onOpenModelSettings={page => openSettings(page)} />}
    {view === 'journey' && <JourneyView key={`${profileController.snapshot?.selected || ''}:${backend?.replay_epoch || ''}`} connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} />}
    {view === 'extensions' && <ExtensionsView connected={Boolean(backend)} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} profileBusy={profileController.busy}
      onCreateProfile={profileController.create} />}
    {view === 'profiles' && <ProfilesView connected={Boolean(backend)} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot} activeProfile={profileController.activeProfile} tabRequest={profileTabRequest} onTabChange={setProfileTab} onCreateOpenChange={setProfileCreateOpen}
      onCreateProfile={profileController.create}
      onExportProfile={profileController.exportArchive}
      onImportProfile={profileController.importArchive}
      onImportPackage={profileController.importPackage}
      onDeleteProfile={profileController.deleteProfile}
      onRenameProfile={profileController.renameProfile}
      onRenameProfileId={profileController.renameProfileId}
      onSaveDescription={profileController.saveDescription}
      onDescribeAuto={profileController.describeAuto}
      onActivateProfile={profileController.activate}
      profileBusy={profileController.busy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} onSelectProfile={name => {
        if (profileMemoryOpen && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return Promise.resolve()
        setPersonalFilesDirty(false)
        return profileController.select(name)
      }}
      memoryOpen={profileMemoryOpen} personalFilesInitialTab={profileFilesInitialTab} onMemoryDirtyChange={setPersonalFilesDirty}
      onCloseMemory={() => {
        if (personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return
        setProfileMemoryOpen(false)
        setPersonalFilesDirty(false)
      }}
      onOpenExtensions={() => { openView('extensions') }} onOpenMemory={() => {
        setProfileFilesInitialTab('memory')
        setProfileMemoryOpen(true)
      }} onOpenSoul={() => { setProfileFilesInitialTab('soul'); setProfileMemoryOpen(true) }}
      onOpenConfiguration={page => { openSettings(page) }} onOpenChannels={() => { openView('channels') }} onOpenUsage={() => { openView('usage') }} onNewChat={() => { void openNewChat() }} onLearnSkill={command => { void learnSkill(command) }} />}
    {view === 'channels' && <ChannelsView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onRestart={() => restartForChannel()} onForceRestart={() => restartForChannel(true)} />}
    {view === 'about' && <AboutView updateStatus={updateStatus} />}
    {view === 'memory' && <PersonalFilesView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onDirtyChange={setPersonalFilesDirty} />}
    {view === 'settings' && <SettingsView language={language} page={settingsPage} connected={Boolean(backend)} profile={viewedProfile} profiles={profileController.snapshot?.profiles || []} profileBusy={profileController.busy || settingsBusy} diagnosticsUnlocked={diagnosticsUnlocked}
      onOpenOnboarding={() => { if (openView('chat')) onboarding.reopen() }}
      onSelectProfile={async name => { if (name === viewedProfile) return true; if (settingsBusy) return false; if (settingsDirty && !window.confirm(t('ui.you.have.unsaved.settings.discard.changes'))) return false; modelController.discardSettingsDraft(); await profileController.select(name); setSettingsDirty(false); return true }}
      onNavigate={page => openSettings(page)}
      onExit={() => { if (openView(settingsReturnView)) { setSettingsDirty(false); onboarding.resume() } }}>
      {settingsPage === 'sessions' && <SessionsView connected={Boolean(backend)} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} onOpenSession={async (profile, id) => { await openProfileSession(profile, id) }} onDeleteSession={deleteProfileSession} />}
      {settingsPage === 'local-tools' && <ToolsView connected={Boolean(backend)} epoch={backend?.replay_epoch || null} generation={workspaceGeneration} onRestart={() => restartBackend().then(Boolean)} />}
      {isConfigurationPage(settingsPage) && <ConfigurationSettings key={backend?.replay_epoch + ':' + viewedProfile + ':' + settingsPage} connected={Boolean(backend)} profile={viewedProfile} page={settingsPage} language={language} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} onNavigate={page => { openSettings(page) }} />}
      {(settingsPage === 'device' || settingsPage === 'quick-input') && <DeviceSettings page={settingsPage} language={language} />}
      {settingsPage === 'delegation' && <DelegationSettings key={backend?.replay_epoch + ':' + viewedProfile} connected={Boolean(backend)} profile={viewedProfile} language={language} providers={modelController.providerCards.map(provider => ({ ...provider, models: modelController.visibleModels(provider.slug) }))} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {settingsPage === 'providers' && <ModelSettingsView connected={Boolean(backend)} profile={viewedProfile} language={language} t={t} controller={modelController} onOpenRuntime={() => openSettings('runtime')} onOpenMain={() => openSettings('main')} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {settingsPage === 'credential-pool' && <CredentialPoolSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={Boolean(backend)} profile={viewedProfile} language={language} />}
      {settingsPage === 'pairing' && <PairingView connected={Boolean(backend)} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} />}
      {settingsPage === 'logs' && <LogsView connected={Boolean(backend)} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} />}
      {settingsPage === 'env-keys' && <EnvKeysView connected={Boolean(backend)} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} onOpenModels={() => openSettings('providers')} onOpenChannels={() => openView('channels')} />}
      {settingsPage === 'main' && <MainModelSettings key={viewedProfile || ''} connected={Boolean(backend)} profile={viewedProfile} language={language} controller={modelController} epoch={backend?.replay_epoch || null} onOpenProviders={() => openSettings('providers')} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {settingsPage === 'moa' && <MoaSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'unselected'}`} connected={Boolean(backend)} profile={viewedProfile} language={language}
        providers={modelController.providerCards.filter(provider => modelController.configuredProviders.some(configured => configured.slug === provider.slug)
          || modelController.customEndpoints.some(endpoint => endpoint.id === provider.slug && endpoint.source !== 'direct-config'))
          .map(provider => ({ ...provider, models: modelController.visibleModels(provider.slug) }))}
        onOpenProviders={() => openSettings('providers')} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {(settingsPage === 'fallbacks' || settingsPage === 'auxiliary') && <ModelRouteSettings key={`${viewedProfile}:${settingsPage}`} page={settingsPage} connected={Boolean(backend)} profile={viewedProfile} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {(settingsPage === 'memory-persistent' || settingsPage === 'memory-context') && <MemoryContextSettings
        key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'unselected'}:${settingsPage}`}
        page={settingsPage} connected={Boolean(backend)} profile={viewedProfile} storagePath={storagePath} language={language}
        onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {(settingsPage === 'notification-alerts' || settingsPage === 'notification-sounds') && <NotificationsSettings page={settingsPage === 'notification-alerts' ? 'alerts' : 'sounds'} language={language} />}
      {(settingsPage === 'runtime' || settingsPage === 'runtime-status' || settingsPage === 'runtime-backup') && <RuntimeView page={settingsPage} storagePath={storagePath} onStoragePathChange={setStoragePath} storageLocked={storageLocked} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} profiles={profileController.snapshot} onChooseStoragePath={chooseStoragePath} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onRestart={restartBackend} onStop={stopBackend} />}
      {settingsPage === 'diagnostics' && <DiagnosticsView storagePath={storagePath} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onStop={stopBackend} />}
      {settingsPage === 'shell-hooks' && <ShellHooksSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={Boolean(backend)} profile={viewedProfile} language={language} />}
      {settingsPage === 'curator' && <CuratorSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={Boolean(backend)} profile={viewedProfile} language={language} />}
      {settingsPage === 'system-operations' && <SystemOperations key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={Boolean(backend)} profile={viewedProfile} language={language} />}
      {settingsPage === 'update' && <UpdateView updateStatus={updateStatus} />}
      {settingsPage === 'documentation' && <DocumentationView />}
      {settingsPage === 'about' && <AboutView updateStatus={updateStatus} />}
    </SettingsView>}
    {view === 'chat' && activeGroupId && <BotGroupConversation key={activeGroupId} roomId={activeGroupId} connected={Boolean(backend)} language={language} onDisband={() => { setActiveGroupId(null); void groupRooms.refresh() }} />}
    <div className="chat-workspace-layout" style={view === 'chat' && !activeGroupId ? undefined : { display: 'none' }}><ChatView active={view === 'chat' && !activeGroupId} connected={Boolean(backend)} backendStatus={backendStatus} language={language} t={t} remoteMode={remoteMode}
      tabs={<ChatTabs tabs={chatTabs.tabs} activeKey={chatTabs.currentKey} disabled={navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || !backend} language={language}
        title={tab => tab.id ? (tab.profile === viewedProfile ? sessions : otherProfileSessions[tab.profile] || []).find(item => item.id === tab.id)?.title || tab.id.slice(0, 12) : language === 'zh-CN' ? '新聊天' : 'New chat'}
        onSelect={tab => { void selectChatTab(tab) }} onClose={tab => { void closeChatTab(tab) }} onOpenWindow={tab => { void chatWindows.open(tab.profile, tab.id).catch(cause => setChatStatus(describeError(cause, language))) }} onNew={() => { void openNewChat() }} />}
      scrollKey={chatTabs.currentKey}
      controller={chatController} workspacePath={remoteMode ? '' : workspaces.selected} onOpenWorkspaces={() => { if (!remoteMode) openView('workspaces') }}
      panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(value => !value)}
      profiles={profileController.snapshot} profileBusy={profileController.busy} onSelectProfile={name => { void profileController.select(name).catch(() => {}) }} picker={{ modelButtonRef, modelPickerRef, pickerPosition, modelPickerOpen, setModelPickerOpen,
        activeModel, savedModel, pickerBusy, pickerError, pickerConfirmation, pickerProviders, pickerProvider, setPickerProvider,
        pickerModels, pickerModelInput, setPickerModelInput, openModelPicker, pickModel }}
      onOpenRuntime={() => openSettings('runtime')} onOpenModelSettings={() => openSettings('main')} onOpenDiagnostics={openDiagnostics} />
      {!remoteMode && <WorkspacePanel open={view === 'chat' && !activeGroupId && panelOpen} onOpenChange={setPanelOpen} cwd={sessionId ? chatController.sessionCurrentDirectory : workspaces.selected} profile={viewedProfile} epoch={backend?.replay_epoch || null} ownerSessionId={sessionId}
        backgroundTasks={chatController.backgroundTasks}
      />}</div>
    </>}
    {dashboardSlotPage && <DashboardPluginSlot name={`${dashboardSlotPage}:bottom`} />}
    <DashboardPluginSlot name="post-main" />
    <footer className="dashboard-plugin-footer">
      <span className="dashboard-plugin-footer-cell"><DashboardPluginSlot name="footer-left" /></span>
      <span className="dashboard-plugin-footer-cell dashboard-plugin-footer-right"><DashboardPluginSlot name="footer-right" /></span>
    </footer>
    </main>
    <div className="dashboard-plugin-overlay"><DashboardPluginSlot name="overlay" /></div>
    {!remoteMode && onboarding.visible && <OnboardingDialog language={language} step={onboarding.step} connected={Boolean(backend)} runtimeBusy={busy} runtimeStatus={backendStatus} profile={viewedProfile} model={savedModel?.model || null}
      messageBusy={turnBusy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || Boolean(chatController.draft.trim()) || chatController.attachments.length > 0}
      onStep={onboarding.setStep} onSkip={() => onboarding.finish('skipped')} onComplete={() => onboarding.finish('completed')}
      onOpenRuntime={() => { if (openSettings('runtime')) onboarding.pause() }} onOpenModels={() => { if (openSettings('providers')) onboarding.pause() }}
      onSend={async message => {
        onboarding.record('message_send_start')
        try {
          if (!openView('chat')) { onboarding.record('message_send_failed'); return false }
          setActiveGroupId(null)
          await newChat(false)
          if (sessionRef.current || storedSessionRef.current) { onboarding.record('message_send_failed'); return false }
          const sent = Boolean(await chatController.sendMessage(message, true))
          if (!sent) onboarding.record('message_send_failed')
          return sent
        } catch (cause) { onboarding.record('message_send_failed'); throw cause }
      }} />}
  </div>
}

function App() {
  const { runtime } = useDesktop()
  const language = useLanguage()
  const [gateway, setGateway] = React.useState<ActiveGateway | null>(null)
  const [switchError, setSwitchError] = React.useState('')
  React.useEffect(() => {
    let live = true
    void runtime.activeGateway().then(value => { if (live) setGateway(value) })
      .catch(error => { if (live) { setSwitchError(describeError(error, language)); setGateway({ mode: 'local' }) } })
    return () => { live = false }
  }, [runtime, language])
  const switchRemote = async () => {
    setSwitchError('')
    try {
      const saved = await runtime.savedRemote()
      if (!saved) throw new Error(language === 'zh-CN' ? '请先在运行时设置中保存远程 Gateway。' : 'Save a remote gateway in Runtime settings first.')
      setGateway(await runtime.activateSavedRemote())
    } catch (error) { setSwitchError(describeError(error, language)) }
  }
  const switchLocal = async () => {
    setSwitchError('')
    try { setGateway(await runtime.activateLocalGateway()) }
    catch (error) { setSwitchError(describeError(error, language)) }
  }
  return <>
    {gateway ? <WorkspaceApp key={gateway.mode === 'remote' ? `remote:${gateway.replay_epoch}` : 'local'} gateway={gateway} onRemote={() => void switchRemote()} onLocal={() => void switchLocal()} />
      : <div className="app-shell"><div className="chat-gate" role="status">{language === 'zh-CN' ? '正在读取 Gateway 连接…' : 'Loading gateway connection…'}</div></div>}
    {switchError && <div className="gateway-switch-error" role="alert">{switchError}<button type="button" onClick={() => setSwitchError('')}>×</button></div>}
  </>
}

export default App
