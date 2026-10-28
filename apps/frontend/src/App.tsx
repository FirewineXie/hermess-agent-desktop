import React from 'react'
import './style.css'
import './features/settings/unified-settings.css'
import AgentSettingsView from './features/agent-settings/AgentSettingsView'
import MemoryProviderSettings from './features/agent-settings/MemoryProviderSettings'
import { useLanguage, translateApp } from './i18n'
import ToolsView from './features/tools/ToolsView'
import ExtensionsView from './features/extensions/ExtensionsView'
import ChatView from './features/chat/ChatView'
import { useChatController } from './features/chat/useChatController'
import ModelSettingsView from './features/models/ModelSettingsView'
import MainModelSettings from './features/models/MainModelSettings'
import MoaSettings from './features/models/MoaSettings'
import DelegationRoutingSettings from './features/models/DelegationRoutingSettings'
import { useModelController } from './features/models/useModelController'
import RuntimeView from './features/runtime/RuntimeView'
import PersonalFilesView from './features/personal-files/PersonalFilesView'
import AboutView from './features/about/AboutView'
import { useUpdateStatus } from './features/about/useUpdateStatus'
import ChannelsView from './features/channels/ChannelsView'
import UsageView from './features/usage/UsageView'
import WorkspacesView from './features/workspaces/WorkspacesView'
import { useWorkspaces } from './features/workspaces/useWorkspaces'
import { useRuntimeController } from './features/runtime/useRuntimeController'
import { useProfiles } from './features/profiles/useProfiles'
import ProfilesView from './features/profiles/ProfilesView'
import Sidebar from './app/Sidebar'
import WorkspaceHeader from './app/WorkspaceHeader'
import WorkspacePanel from './features/workspace-panel/WorkspacePanel'
import ScheduledTasksView from './features/scheduled-tasks/ScheduledTasksView'
import NotificationsSettings, { useNativeNotificationBridge } from './features/notifications/notifications'
import SettingsView from './features/settings/SettingsView'
import AdvancedDeviceSettings, { readDevicePreferences } from './features/settings/AdvancedDeviceSettings'
import SharedMetricsSettings from './features/settings/SharedMetricsSettings'
import CheckpointInventory from './features/settings/CheckpointInventory'
import { defaultSettingsLocation, normalizeSettingsLocation, type SettingsCategory, type SettingsLocation } from './features/settings/model'
import type { View } from './app/types'
import type { ModelPick } from './features/models/model'
import type { SessionRow } from '@hermess/contracts'
import { useDesktop } from './app/DesktopContext'
import { describeError } from './app/desktopErrors'
import { discardProfileFeatureState, useProfileState, workspaceKey } from './app/profile-scope/ProfileWorkspace'

function App({ initialSettings }: { initialSettings?: SettingsLocation }) {
  const { chat, connections, windowChrome, quickEntry } = useDesktop()
  const initialDevicePreferences = React.useRef(readDevicePreferences()).current
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(languageRef.current, key, ...values), [])
  const [view, setView] = React.useState<View>(initialSettings ? 'settings' : 'chat')
  const [settingsLocation, setSettingsLocation] = React.useState<SettingsLocation>(() => initialSettings ? normalizeSettingsLocation(initialSettings) : defaultSettingsLocation())
  const [agentConfigDirty, setAgentConfigDirty] = React.useState(false)
  const [delegationDirty, setDelegationDirty] = React.useState(false)
  const [personalFilesDirty, setPersonalFilesDirty] = React.useState(false)
  const [profileMemoryOpen, setProfileMemoryOpen] = React.useState(false)
  const [profileAgentOpen, setProfileAgentOpen] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const settingsReturnViewRef = React.useRef<View>('chat')
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [aboutInitialTab, setAboutInitialTab] = React.useState<'license' | 'update'>('license')
  const [updateTabRequest, setUpdateTabRequest] = React.useState(0)
  React.useEffect(() => { void windowChrome.setFrontendDebugEnabled(initialDevicePreferences.f12Devtools).catch(() => {}) }, [windowChrome, initialDevicePreferences.f12Devtools])
  const updateStatus = useUpdateStatus()
  const workspaces = useWorkspaces()
  const {
    pythonPath, setPythonPath, storagePath, setStoragePath, storageLocked, debugMode, debugButtonVisible, changeDebugMode,
    backend, setBackend, workspaceGeneration, backendStatus, setBackendStatus, busy, setBusy,
    startBackend, chooseStoragePath, pingBackend, stopBackend, restartBackend, forceRestartBackend,
  } = useRuntimeController({
    t,
    initialDebugMode: initialDevicePreferences.f12Devtools,
    onReset: () => { setActiveModel(null); resetChat(); resetModel() },
  })
  const profileController = useProfiles({
    connected: Boolean(backend),
    remote: Boolean(backend && 'kind' in backend && backend.kind === 'remote'),
    backendEpoch: backend ? `${backend.connection_id}:${backend.replay_epoch}` : null,
    restart: () => restartBackend(),
  })
  const viewedProfile = profileController.snapshot?.selected || null
  const [activeModel, setActiveModel] = useProfileState<ModelPick | null>(workspaceKey(backend?.replay_epoch, viewedProfile), null, 'app:active-model')
  const chatController = useChatController({
    backend, profile: viewedProfile, chatVisible: view === 'chat', activeModel, language, storagePath, workspacePath: workspaces.selected, t,
    openView: next => openView(next), setSidebarOpen, setActiveModel,
    setModelPickerOpen: value => modelController.setModelPickerOpen(value),
    setBackend, setBackendStatus, setBusy,
  })
  const {
    sessionId, sessionRef, sessionProfileRef, storedSessionRef, setChatStatus, turnBusy, navigationBusy, sessionCreating, reasoningBusy, sessions, sessionsState,
    attachmentBusy, loadSessions, newChat, resumeSession,
    reconnectBackend, resetChat,
  } = chatController
  useNativeNotificationBridge(backend?.connection_id || null, viewedProfile && sessionId ? { profile: viewedProfile, sessionId } : undefined)
  const modelController = useModelController({ backend, profile: viewedProfile, storagePath, t, sessionRef, sessionProfileRef, turnBusy, setChatStatus, setActiveModel })
  const quickEntryContext = React.useRef({ backend, viewedProfile, turnBusy, navigationBusy, attachmentBusy, chatController })
  quickEntryContext.current = { backend, viewedProfile, turnBusy, navigationBusy, attachmentBusy, chatController }
  React.useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void quickEntry.onSubmit(async request => {
      const current = quickEntryContext.current
      let ok = false
      let message = ''
      if (!current.backend || !current.viewedProfile) message = '请先在主窗口连接 Gateway 并选择 Profile。'
      else if (current.turnBusy || current.navigationBusy || current.attachmentBusy || current.chatController.attachments.length) message = '当前会话忙碌或含附件，请在主窗口处理后再发送。'
      else if (request.text.trim().startsWith('/')) message = '快捷输入只接受普通消息；命令请在主窗口执行。'
      else {
        const result = await current.chatController.sendMessage(request.text, undefined, true)
        ok = result === true
        if (!ok) message = '提交结果未确认，请先检查主窗口会话，避免重复发送。'
      }
      if (active) void quickEntry.acknowledge(request.id, ok, message).catch(() => {})
    }).then(fn => { if (active) unsubscribe = fn; else fn() })
      .catch(() => {})
    return () => { active = false; unsubscribe?.() }
  }, [quickEntry])
  const {
    savedModel, modelPickerOpen, setModelPickerOpen, modelButtonRef, modelPickerRef,
    pickerPosition, pickerProviders, pickerProvider, setPickerProvider, pickerModelInput,
    setPickerModelInput, pickerBusy, pickerError, pickerConfirmation, pickerModels,
    loadModelOptions, openModelPicker, pickModel, resetModel, modelOptionsLoaded,
  } = modelController
  React.useEffect(() => {
    if (!backend || !viewedProfile) return
    if (sessionsState !== 'ready') void loadSessions(true, viewedProfile)
    if (!modelOptionsLoaded) void loadModelOptions()
  }, [backend, viewedProfile])
  const openView = (next: View): boolean => {
    if (next === view) { setSidebarOpen(false); return true }
    if (((view === 'agent' && next !== 'agent') || (view === 'settings' && next !== 'settings') || (view === 'profiles' && profileAgentOpen && next !== 'profiles')) && (agentConfigDirty || delegationDirty) && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return false
    if ((view === 'memory' || (view === 'profiles' && profileMemoryOpen)) && next !== view && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return false
    if (next !== view && (view === 'agent' || view === 'settings' || (view === 'profiles' && profileAgentOpen))) {
      setAgentConfigDirty(false)
      setDelegationDirty(false)
    }
    if (next !== 'memory') setPersonalFilesDirty(false)
    if (next !== 'profiles') setProfileMemoryOpen(false)
    if (next !== 'profiles') setProfileAgentOpen(false)
    if (next === 'about') setAboutInitialTab('license')
    setView(next)
    setSidebarOpen(false)
    return true
  }
  const openSettings = (category: SettingsCategory, subpage?: string): boolean => {
    const previousView = view
    const next = normalizeSettingsLocation({ category, subpage: subpage || defaultSettingsLocation(category).subpage })
    const changed = next.category !== settingsLocation.category || next.subpage !== settingsLocation.subpage
    if (view === 'settings' && changed && (agentConfigDirty || delegationDirty) && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return false
    if (!openView('settings')) return false
    if (previousView !== 'settings') settingsReturnViewRef.current = previousView
    setSettingsLocation(next)
    if (changed) {
      setAgentConfigDirty(false)
      setDelegationDirty(false)
    }
    return true
  }
  const navigateSettings = (next: SettingsLocation) => openSettings(next.category, next.subpage)
  const selectSettingsProfile = async (name: string): Promise<boolean> => {
    if (!name || name === viewedProfile) return false
    if ((agentConfigDirty || delegationDirty) && !window.confirm(t('ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave'))) return false
    await profileController.select(name)
    if (viewedProfile) {
      const oldWorkspace = workspaceKey(backend?.replay_epoch, viewedProfile)
      discardProfileFeatureState(oldWorkspace, 'agent-settings')
      discardProfileFeatureState(oldWorkspace, 'models')
    }
    const nextWorkspace = workspaceKey(backend?.replay_epoch, name)
    discardProfileFeatureState(nextWorkspace, 'agent-settings')
    discardProfileFeatureState(nextWorkspace, 'models')
    setAgentConfigDirty(false)
    setDelegationDirty(false)
    return true
  }
  const activeSession = sessions.find(session => session.id === storedSessionRef.current)
  const [otherProfileSessions, setOtherProfileSessions] = useProfileState<Record<string, SessionRow[]>>(workspaceKey(backend?.replay_epoch, 'sidebar-other'), {}, 'app:other-profile-sessions')
  const otherSessionsVersion = React.useRef(0)
  const [pendingSession, setPendingSession] = React.useState<{ profile: string; id: string } | null>(null)
  const beforeConnectionSwitch = () => {
    if ((agentConfigDirty || delegationDirty) && !window.confirm(t('ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave'))) return false
    if (personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return false
    if (turnBusy && !window.confirm(language === 'zh-CN' ? '当前会话仍在运行。切换连接会断开此会话的实时事件，确定继续？' : 'The current session is still running. Switching connections will detach its live events. Continue?')) return false
    return true
  }
  const switchConnection = (next: typeof backend) => {
    resetChat(true)
    resetModel()
    setActiveModel(null)
    setPendingSession(null)
    setAgentConfigDirty(false)
    setDelegationDirty(false)
    setPersonalFilesDirty(false)
    setPanelOpen(false)
    setBackend(next)
  }
  const returnToLocalConnection = async () => {
    if (!beforeConnectionSwitch()) return
    const info = await connections.returnToLocal()
    switchConnection(info)
  }
  const servedProfileNames = profileController.snapshot?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]).filter(name => name !== profileController.snapshot?.selected).join('|') || ''
  const refreshOtherProfileSessions = async () => {
    const version = ++otherSessionsVersion.current
    const names = [...new Set(servedProfileNames.split('|').filter(Boolean))]
    const results = await Promise.allSettled(names.map(name => chat.listSessions({ kind: 'profile', profile: name })))
    if (version === otherSessionsVersion.current) setOtherProfileSessions(Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value.sessions : []])))
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
  const openProfileSession = async (profile: string, id: string) => {
    if (!openView('chat')) return
    try {
      if (profileController.snapshot?.selected !== profile) await profileController.select(profile)
      setPendingSession({ profile, id })
    } catch { /* useProfiles reports selection errors in the sidebar */ }
  }
  React.useEffect(() => {
    const openNotifiedSession = (event: Event) => {
      const target = (event as CustomEvent<{ connectionId?: string; profile?: string; sessionId?: string }>).detail
      if (target?.connectionId === backend?.connection_id && target.profile && target.sessionId) void openProfileSession(target.profile, target.sessionId)
    }
    window.addEventListener('hermess-open-session', openNotifiedSession)
    return () => window.removeEventListener('hermess-open-session', openNotifiedSession)
  }, [view, agentConfigDirty, personalFilesDirty, profileController.snapshot?.selected, backend?.connection_id])
  React.useEffect(() => {
    const answerNotifiedApproval = (event: Event) => {
      const target = (event as CustomEvent<{ connectionId?: string; profile?: string; sessionId?: string; approvalRequestId?: string; choice?: 'once' | 'deny' }>).detail
      if (target?.connectionId !== backend?.connection_id || !target.profile || !target.sessionId || !target.approvalRequestId || !target.choice) return
      if (chatController.serverRequest?.id === target.approvalRequestId && chatController.serverRequest.method === 'approval'
        && chatController.serverRequest.profile === target.profile && chatController.serverRequest.params.session_id === target.sessionId) {
        void chatController.answerRequest(target.choice)
      } else {
        void chat.answerRequest({ kind: 'session', profile: target.profile, sessionId: target.sessionId }, { requestId: target.approvalRequestId, method: 'approval', choice: target.choice })
          .catch(cause => setChatStatus(t('ui.failed.to.process.request.arg', describeError(cause, language))))
      }
    }
    window.addEventListener('hermess-notification-approval', answerNotifiedApproval)
    return () => window.removeEventListener('hermess-notification-approval', answerNotifiedApproval)
  }, [backend?.connection_id, chatController.serverRequest?.id, viewedProfile, sessionId])
  React.useEffect(() => {
    if (!pendingSession || pendingSession.profile !== viewedProfile) return
    void resumeSession(pendingSession.id, false, backend?.replay_epoch || '', pendingSession.profile)
    setPendingSession(null)
  }, [pendingSession, viewedProfile])
  const restartForChannel = async (force = false) => {
    const restarted = force ? await forceRestartBackend() : await restartBackend()
    return Boolean(restarted)
  }
  return <div className={`app-shell ${windowChrome.customTitlebar ? 'custom-titlebar-shell' : ''} ${view === 'profiles' ? 'profile-page-shell' : ''} ${view === 'settings' ? 'settings-page-shell' : ''}`}>
    <WorkspaceHeader view={view} sessionTitle={activeSession?.title} sessionSource={activeSession?.source} connected={Boolean(backend)} connectionLabel={backend && 'kind' in backend ? backend.label : undefined} updateVersion={updateStatus.candidate?.asset ? updateStatus.candidate.version : null} onOpenNavigation={() => setSidebarOpen(true)} onOpenView={openView} onOpenSettings={(category, subpage) => { openSettings(category, subpage) }} onOpenUpdate={() => { if (openSettings('about', 'updates')) { setAboutInitialTab('update'); setUpdateTabRequest(value => value + 1) } }} />
    {view !== 'settings' && <Sidebar view={view} open={sidebarOpen} connected={Boolean(backend)} remote={Boolean(backend && backend.connection_id !== 'local')} busy={navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} sessions={sessions} otherProfileSessions={otherProfileSessions} sessionsState={sessionsState} activeSessionId={storedSessionRef.current} onClose={() => setSidebarOpen(false)} onOpenView={openView} onNewChat={() => { if (openView('chat')) void newChat() }} onResumeSession={(profile, id) => { void openProfileSession(profile, id) }}
      profiles={profileController.snapshot} profileBusy={profileController.busy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} profileError={profileController.error} profilePendingRestart={profileController.pendingRestart}
      onRetryProfile={() => void profileController.retryPending()}
      onOpenProfile={name => {
        if (profileController.snapshot?.selected !== name && profileAgentOpen && agentConfigDirty && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return
        if (openView('profiles') && profileController.snapshot?.selected !== name) void profileController.select(name).then(() => setAgentConfigDirty(false)).catch(() => {})
      }} />}
    <main className="workspace">
    {view === 'workspaces' && <WorkspacesView connected={Boolean(backend)} busy={navigationBusy || sessionCreating || turnBusy || attachmentBusy || reasoningBusy || pickerBusy}
      paths={workspaces.paths} selected={workspaces.selected} onAdd={workspaces.add} onSelect={workspaces.select} onRemove={workspaces.remove}
      onNewChat={path => { if (openView('chat')) { workspaces.select(path); void newChat() } }} />}
    {view === 'scheduled' && <ScheduledTasksView key={workspaceGeneration} connected={Boolean(backend)} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot} />}
    {view === 'tools' && <ToolsView connected={Boolean(backend)} epoch={backend?.replay_epoch || null} generation={workspaceGeneration} onRestart={() => restartBackend().then(Boolean)} />}
    {view === 'usage' && <UsageView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} />}
    {view === 'extensions' && <ExtensionsView connected={Boolean(backend)} remote={Boolean(backend && 'kind' in backend && backend.kind === 'remote')} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} profileBusy={profileController.busy}
      onCreateProfile={profileController.create} />}
    {view === 'profiles' && <ProfilesView connected={Boolean(backend)} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot} storagePath={storagePath}
      profileBusy={profileController.busy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} onSelectProfile={name => {
        if (profileAgentOpen && agentConfigDirty && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return Promise.resolve()
        if (profileMemoryOpen && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return Promise.resolve()
        setPersonalFilesDirty(false)
        setAgentConfigDirty(false)
        return profileController.select(name)
      }}
      memoryOpen={profileMemoryOpen} onMemoryDirtyChange={setPersonalFilesDirty}
      agentSettingsOpen={profileAgentOpen} onAgentDirtyChange={setAgentConfigDirty}
      onCloseAgentSettings={() => {
        if (agentConfigDirty && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return
        setProfileAgentOpen(false)
        setAgentConfigDirty(false)
      }}
      onOpenModelSettings={() => { openSettings('model') }}
      onCloseMemory={() => {
        if (personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return
        setProfileMemoryOpen(false)
        setPersonalFilesDirty(false)
      }}
      onOpenExtensions={() => { openView('extensions') }} onOpenMemory={() => {
        if (profileAgentOpen && agentConfigDirty && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return
        setProfileAgentOpen(false)
        setAgentConfigDirty(false)
        setProfileMemoryOpen(true)
      }}
      onOpenAgentSettings={() => {
        if (profileMemoryOpen && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return
        setProfileMemoryOpen(false)
        setPersonalFilesDirty(false)
        setProfileAgentOpen(true)
      }} onOpenChannels={() => { openView('channels') }} onOpenUsage={() => { openView('usage') }} onNewChat={() => { if (openView('chat')) void newChat() }} />}
    {view === 'channels' && <ChannelsView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onRestart={() => restartForChannel()} onForceRestart={() => restartForChannel(true)} />}
    {view === 'about' && <AboutView initialTab={aboutInitialTab} updateTabRequest={updateTabRequest} updateStatus={updateStatus} />}
    {view === 'memory' && <PersonalFilesView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onDirtyChange={setPersonalFilesDirty} />}
    {view === 'agent' && <AgentSettingsView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => { openSettings('model') }} />}
    {view === 'runtime' && <RuntimeView storagePath={storagePath} onStoragePathChange={setStoragePath} storageLocked={storageLocked} debugMode={debugMode} debugButtonVisible={debugButtonVisible} onDebugModeChange={changeDebugMode} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} onChooseStoragePath={chooseStoragePath} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onStop={stopBackend} onReturnToLocal={returnToLocalConnection} />}
    {view === 'model' && <ModelSettingsView connected={Boolean(backend)} profile={viewedProfile} language={language} t={t} controller={modelController} profiles={profileController.snapshot?.profiles || []} onOpenRuntime={() => openView('runtime')} />}
    {view === 'settings' && <SettingsView language={language} location={settingsLocation} profile={viewedProfile} connected={Boolean(backend)} profiles={profileController.snapshot?.profiles || []} profileBusy={profileController.busy} onSelectProfile={selectSettingsProfile} onNavigate={navigateSettings} onExit={() => { void openView(settingsReturnViewRef.current) }}>
      {settingsLocation.category === 'model' && settingsLocation.subpage === 'providers' && <ModelSettingsView connected={Boolean(backend)} profile={viewedProfile} language={language} t={t} controller={modelController} profiles={profileController.snapshot?.profiles || []} onOpenRuntime={() => { openSettings('gateway', 'runtime') }} />}
      {settingsLocation.category === 'model' && !['providers', 'moa'].includes(settingsLocation.subpage) && <>{settingsLocation.subpage === 'main' && <MainModelSettings connected={Boolean(backend)} profile={viewedProfile} language={language} controller={modelController} onOpenProviders={() => { openSettings('model', 'providers') }} />}<AgentSettingsView connected={Boolean(backend)} profile={viewedProfile} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => { openSettings('model') }} embedded sectionOverride={`model.${settingsLocation.subpage}`} />{settingsLocation.subpage === 'delegation' && <DelegationRoutingSettings profile={viewedProfile} connected={Boolean(backend)} onDirtyChange={setDelegationDirty} />}</>}
      {settingsLocation.category === 'model' && settingsLocation.subpage === 'moa' && <MoaSettings connected={Boolean(backend)} profile={viewedProfile} />}
      {settingsLocation.category === 'gateway' && settingsLocation.subpage === 'runtime' && <RuntimeView storagePath={storagePath} onStoragePathChange={setStoragePath} storageLocked={storageLocked} debugMode={debugMode} debugButtonVisible={debugButtonVisible} onDebugModeChange={changeDebugMode} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} onChooseStoragePath={chooseStoragePath} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onStop={stopBackend} onReturnToLocal={returnToLocalConnection} />}
      {settingsLocation.category === 'notifications' && <NotificationsSettings page={settingsLocation.subpage as 'alerts' | 'sounds'} />}
      {settingsLocation.category === 'memory' && <><AgentSettingsView connected={Boolean(backend)} profile={viewedProfile} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => { openSettings('model') }} embedded sectionOverride={`memory.${settingsLocation.subpage}`} />{settingsLocation.subpage === 'persistent' && <MemoryProviderSettings connected={Boolean(backend)} profile={viewedProfile} />}</>}
      {settingsLocation.category === 'security' && <><AgentSettingsView connected={Boolean(backend)} profile={viewedProfile} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => { openSettings('model') }} embedded sectionOverride={`security.${settingsLocation.subpage}`} />{settingsLocation.subpage === 'privacy' && <SharedMetricsSettings profile={viewedProfile} connected={Boolean(backend)} />}{settingsLocation.subpage === 'checkpoints' && <CheckpointInventory profile={viewedProfile} connected={Boolean(backend)} epoch={backend?.replay_epoch || null} />}</>}
      {settingsLocation.category === 'voice' && <AgentSettingsView connected={Boolean(backend)} profile={viewedProfile} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => { openSettings('model') }} embedded sectionOverride={`voice.${settingsLocation.subpage}`} />}
      {settingsLocation.category === 'advanced' && <><AgentSettingsView connected={Boolean(backend)} profile={viewedProfile} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => { openSettings('model') }} embedded sectionOverride={`advanced.${settingsLocation.subpage}`} />{settingsLocation.subpage === 'desktop' && <AdvancedDeviceSettings />}</>}
      {settingsLocation.category === 'about' && <AboutView initialTab={settingsLocation.subpage === 'updates' ? 'update' : aboutInitialTab} updateTabRequest={updateTabRequest} updateStatus={updateStatus} />}
    </SettingsView>}
    <div className="chat-workspace-layout" style={view === 'chat' ? undefined : { display: 'none' }}><ChatView connected={Boolean(backend)} visible={view === 'chat'} remote={Boolean(backend && backend.connection_id !== 'local')} connectionKey={backend ? `${backend.connection_id}:${backend.replay_epoch}` : 'offline'} backendStatus={backendStatus} language={language} t={t}
      controller={chatController} workspacePath={workspaces.selected} onOpenWorkspaces={() => openView('workspaces')}
      panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(value => !value)}
      profiles={profileController.snapshot} profileBusy={profileController.busy} onSelectProfile={name => { void profileController.select(name).catch(() => {}) }} picker={{ modelButtonRef, modelPickerRef, pickerPosition, modelPickerOpen, setModelPickerOpen,
        activeModel, savedModel, pickerBusy, pickerError, pickerConfirmation, pickerProviders, pickerProvider, setPickerProvider,
        pickerModels, pickerModelInput, setPickerModelInput, openModelPicker, pickModel }}
      onOpenRuntime={() => { openSettings('gateway', 'runtime') }} onOpenModelSettings={() => { openSettings('model') }} />
      <WorkspacePanel open={view === 'chat' && panelOpen && (!backend || backend.connection_id === 'local')} onOpenChange={setPanelOpen} cwd={sessionId ? chatController.sessionCurrentDirectory : workspaces.selected} profile={viewedProfile} epoch={backend?.replay_epoch || null} ownerSessionId={sessionId}
      /></div>
    </main>
  </div>
}

export default App
