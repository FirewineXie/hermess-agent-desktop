import React from 'react'
import './style.css'
import AgentSettingsView from './features/agent-settings/AgentSettingsView'
import { useLanguage, translateApp } from './i18n'
import ToolsView from './features/tools/ToolsView'
import ExtensionsView from './features/extensions/ExtensionsView'
import ChatView from './features/chat/ChatView'
import { useChatController } from './features/chat/useChatController'
import ModelSettingsView from './features/models/ModelSettingsView'
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
import type { View } from './app/types'
import type { ModelPick } from './features/models/model'
import type { SessionRow } from '@hermess/contracts'
import { useDesktop } from './app/DesktopContext'
import { useProfileState, workspaceKey } from './app/profile-scope/ProfileWorkspace'

function App() {
  const { chat, windowChrome } = useDesktop()
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(languageRef.current, key, ...values), [])
  const [view, setView] = React.useState<View>('chat')
  const [agentConfigDirty, setAgentConfigDirty] = React.useState(false)
  const [personalFilesDirty, setPersonalFilesDirty] = React.useState(false)
  const [profileMemoryOpen, setProfileMemoryOpen] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [aboutInitialTab, setAboutInitialTab] = React.useState<'license' | 'update'>('license')
  const [updateTabRequest, setUpdateTabRequest] = React.useState(0)
  const updateStatus = useUpdateStatus()
  const workspaces = useWorkspaces()
  const {
    pythonPath, setPythonPath, storagePath, setStoragePath, storageLocked, debugMode, debugButtonVisible, changeDebugMode,
    backend, setBackend, workspaceGeneration, backendStatus, setBackendStatus, busy, setBusy,
    startBackend, chooseStoragePath, pingBackend, stopBackend, restartBackend, forceRestartBackend,
  } = useRuntimeController({
    t,
    onReset: () => { setActiveModel(null); resetChat(); resetModel() },
  })
  const profileController = useProfiles({
    connected: Boolean(backend),
    backendEpoch: backend?.replay_epoch || null,
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
    attachmentBusy, ensureChatSession, loadSessions, newChat, resumeSession,
    reconnectBackend, resetChat,
  } = chatController
  const modelController = useModelController({ backend, profile: viewedProfile, storagePath, t, sessionRef, sessionProfileRef, turnBusy, ensureChatSession, setChatStatus, setActiveModel })
  const {
    savedModel, modelPickerOpen, setModelPickerOpen, modelButtonRef, modelPickerRef,
    pickerPosition, pickerProviders, pickerProvider, setPickerProvider, pickerModelInput,
    setPickerModelInput, pickerBusy, pickerError, pickerConfirmation, pickerModels,
    loadModelOptions, openModelPicker, pickModel, resetModel, modelOptionsLoaded,
  } = modelController
  React.useEffect(() => {
    if (!backend || !viewedProfile) return
    if (sessionsState !== 'ready') void loadSessions(true, viewedProfile)
    if (!modelOptionsLoaded) void loadModelOptions(true)
  }, [backend, viewedProfile])
  const openView = (next: View): boolean => {
    if (next === view) { setSidebarOpen(false); return true }
    if (view === 'agent' && next !== 'agent' && agentConfigDirty && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return false
    if ((view === 'memory' || (view === 'profiles' && profileMemoryOpen)) && next !== view && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return false
    if (next !== 'agent') setAgentConfigDirty(false)
    if (next !== 'memory') setPersonalFilesDirty(false)
    if (next !== 'profiles') setProfileMemoryOpen(false)
    if (next === 'about') setAboutInitialTab('license')
    setView(next)
    setSidebarOpen(false)
    return true
  }
  const activeSession = sessions.find(session => session.id === storedSessionRef.current)
  const [otherProfileSessions, setOtherProfileSessions] = useProfileState<Record<string, SessionRow[]>>(workspaceKey(backend?.replay_epoch, 'sidebar-other'), {}, 'app:other-profile-sessions')
  const otherSessionsVersion = React.useRef(0)
  const [pendingSession, setPendingSession] = React.useState<{ profile: string; id: string } | null>(null)
  const servedProfileNames = profileController.snapshot?.gateways.flatMap(gateway => gateway.served_profiles || [gateway.profile]).filter(name => name !== profileController.snapshot?.selected).join('|') || ''
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
    if (!pendingSession || pendingSession.profile !== viewedProfile) return
    void resumeSession(pendingSession.id, false, backend?.replay_epoch || '', pendingSession.profile)
    setPendingSession(null)
  }, [pendingSession, viewedProfile])
  const restartForChannel = async (force = false) => {
    const restarted = force ? await forceRestartBackend() : await restartBackend()
    return Boolean(restarted)
  }
  return <div className={`app-shell ${windowChrome.customTitlebar ? 'custom-titlebar-shell' : ''} ${view === 'profiles' ? 'profile-page-shell' : ''}`}>
    <WorkspaceHeader view={view} sessionTitle={activeSession?.title} sessionSource={activeSession?.source} connected={Boolean(backend)} updateVersion={updateStatus.candidate?.asset ? updateStatus.candidate.version : null} onOpenNavigation={() => setSidebarOpen(true)} onOpenView={openView} onOpenUpdate={() => { if (openView('about')) { setAboutInitialTab('update'); setUpdateTabRequest(value => value + 1) } }} />
    <Sidebar view={view} open={sidebarOpen} connected={Boolean(backend)} busy={navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} sessions={sessions} otherProfileSessions={otherProfileSessions} sessionsState={sessionsState} activeSessionId={storedSessionRef.current} onClose={() => setSidebarOpen(false)} onOpenView={openView} onNewChat={() => { if (openView('chat')) void newChat() }} onResumeSession={(profile, id) => { void openProfileSession(profile, id) }}
      profiles={profileController.snapshot} profileBusy={profileController.busy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} profileError={profileController.error} profilePendingRestart={profileController.pendingRestart}
      onRetryProfile={() => void profileController.retryPending()}
      onOpenProfile={name => { if (openView('profiles') && profileController.snapshot?.selected !== name) void profileController.select(name).catch(() => {}) }} />
    <main className="workspace">
    {view === 'workspaces' && <WorkspacesView connected={Boolean(backend)} busy={navigationBusy || sessionCreating || turnBusy || attachmentBusy || reasoningBusy || pickerBusy}
      paths={workspaces.paths} selected={workspaces.selected} onAdd={workspaces.add} onSelect={workspaces.select} onRemove={workspaces.remove}
      onNewChat={path => { if (openView('chat')) { workspaces.select(path); void newChat() } }} />}
    {view === 'scheduled' && <ScheduledTasksView key={workspaceGeneration} connected={Boolean(backend)} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot} />}
    {view === 'tools' && <ToolsView connected={Boolean(backend)} epoch={backend?.replay_epoch || null} generation={workspaceGeneration} />}
    {view === 'usage' && <UsageView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} />}
    {view === 'extensions' && <ExtensionsView connected={Boolean(backend)} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} profileBusy={profileController.busy}
      onCreateProfile={profileController.create} />}
    {view === 'profiles' && <ProfilesView connected={Boolean(backend)} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot}
      profileBusy={profileController.busy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} onSelectProfile={name => {
        if (profileMemoryOpen && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return Promise.resolve()
        setPersonalFilesDirty(false)
        return profileController.select(name)
      }}
      memoryOpen={profileMemoryOpen} onMemoryDirtyChange={setPersonalFilesDirty}
      onCloseMemory={() => {
        if (personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return
        setProfileMemoryOpen(false)
        setPersonalFilesDirty(false)
      }}
      onOpenExtensions={() => { openView('extensions') }} onOpenMemory={() => { setProfileMemoryOpen(true) }}
      onOpenAgentSettings={() => { openView('agent') }} onOpenChannels={() => { openView('channels') }} onOpenUsage={() => { openView('usage') }} onNewChat={() => { if (openView('chat')) void newChat() }} />}
    {view === 'channels' && <ChannelsView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onRestart={() => restartForChannel()} onForceRestart={() => restartForChannel(true)} />}
    {view === 'about' && <AboutView initialTab={aboutInitialTab} updateTabRequest={updateTabRequest} updateStatus={updateStatus} />}
    {view === 'memory' && <PersonalFilesView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onDirtyChange={setPersonalFilesDirty} />}
    {view === 'agent' && <AgentSettingsView connected={Boolean(backend)} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => openView('model')} />}
    {view === 'runtime' && <RuntimeView storagePath={storagePath} onStoragePathChange={setStoragePath} storageLocked={storageLocked} debugMode={debugMode} debugButtonVisible={debugButtonVisible} onDebugModeChange={changeDebugMode} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} onChooseStoragePath={chooseStoragePath} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onStop={stopBackend} />}
    {view === 'model' && <ModelSettingsView connected={Boolean(backend)} language={language} t={t} controller={modelController} onOpenRuntime={() => openView('runtime')} />}
    <div className="chat-workspace-layout" style={view === 'chat' ? undefined : { display: 'none' }}><ChatView connected={Boolean(backend)} backendStatus={backendStatus} language={language} t={t}
      controller={chatController} workspacePath={workspaces.selected} onOpenWorkspaces={() => openView('workspaces')}
      panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(value => !value)}
      profiles={profileController.snapshot} profileBusy={profileController.busy} onSelectProfile={name => { void profileController.select(name).catch(() => {}) }} picker={{ modelButtonRef, modelPickerRef, pickerPosition, modelPickerOpen, setModelPickerOpen,
        activeModel, savedModel, pickerBusy, pickerError, pickerConfirmation, pickerProviders, pickerProvider, setPickerProvider,
        pickerModels, pickerModelInput, setPickerModelInput, openModelPicker, pickModel }}
      onOpenRuntime={() => openView('runtime')} onOpenModelSettings={() => openView('model')} />
      <WorkspacePanel open={view === 'chat' && panelOpen} onOpenChange={setPanelOpen} cwd={sessionId ? chatController.sessionCurrentDirectory : workspaces.selected} profile={viewedProfile} epoch={backend?.replay_epoch || null} ownerSessionId={sessionId}
      /></div>
    </main>
  </div>
}

export default App
