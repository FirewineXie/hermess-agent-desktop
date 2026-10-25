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
import ChannelsView from './features/channels/ChannelsView'
import UsageView from './features/usage/UsageView'
import WorkspacesView from './features/workspaces/WorkspacesView'
import { useWorkspaces } from './features/workspaces/useWorkspaces'
import { useRuntimeController } from './features/runtime/useRuntimeController'
import Sidebar from './app/Sidebar'
import WorkspaceHeader from './app/WorkspaceHeader'
import type { View } from './app/types'
import type { ModelPick } from './features/models/model'

function App() {
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(languageRef.current, key, ...values), [])
  const [view, setView] = React.useState<View>('chat')
  const [agentConfigDirty, setAgentConfigDirty] = React.useState(false)
  const [personalFilesDirty, setPersonalFilesDirty] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [activeModel, setActiveModel] = React.useState<ModelPick | null>(null)
  const workspaces = useWorkspaces()
  const {
    pythonPath, setPythonPath, storagePath, setStoragePath, storageLocked,
    backend, setBackend, backendStatus, setBackendStatus, busy, setBusy,
    startBackend, chooseStoragePath, pingBackend, stopBackend, restartBackend, forceRestartBackend,
  } = useRuntimeController({
    t,
    onStarted: () => { void loadModelOptions(); void loadSessions(true) },
    onReset: () => { setActiveModel(null); resetChat(); resetModel() },
  })
  const chatController = useChatController({
    backend, chatVisible: view === 'chat', activeModel, language, storagePath, workspacePath: workspaces.selected, t,
    openView: next => openView(next), setSidebarOpen, setActiveModel,
    setModelPickerOpen: value => modelController.setModelPickerOpen(value),
    setBackend, setBackendStatus, setBusy,
  })
  const {
    sessionId, sessionRef, storedSessionRef, setChatStatus, turnBusy, navigationBusy, sessionCreating, reasoningBusy, sessions, sessionsState,
    attachmentBusy, ensureChatSession, loadSessions, newChat, resumeSession,
    reconnectBackend, resetChat,
  } = chatController
  const modelController = useModelController({ backend, storagePath, t, sessionRef, turnBusy, ensureChatSession, setChatStatus, setActiveModel })
  const {
    savedModel, modelPickerOpen, setModelPickerOpen, modelButtonRef, modelPickerRef,
    pickerPosition, pickerProviders, pickerProvider, setPickerProvider, pickerModelInput,
    setPickerModelInput, pickerBusy, pickerError, pickerConfirmation, pickerModels,
    loadModelOptions, openModelPicker, pickModel, resetModel,
  } = modelController
  const openView = (next: View): boolean => {
    if (view === 'agent' && next !== 'agent' && agentConfigDirty && !window.confirm(t("ui.there.are.unsaved.agent.configurations.are.you.sure.you.want.to.leave"))) return false
    if (view === 'memory' && next !== 'memory' && personalFilesDirty && !window.confirm(t('ui.unsaved.personal.files.leave'))) return false
    if (next !== 'agent') setAgentConfigDirty(false)
    if (next !== 'memory') setPersonalFilesDirty(false)
    setView(next)
    setSidebarOpen(false)
    return true
  }
  const activeSession = sessions.find(session => session.id === storedSessionRef.current)
  const restartForChannel = async (force = false) => {
    const selectedSession = storedSessionRef.current
    const restarted = force ? await forceRestartBackend() : await restartBackend()
    if (!restarted) return false
    if (selectedSession) await resumeSession(selectedSession, true, restarted.replay_epoch)
    return true
  }
  return <div className="app-shell">
    <Sidebar view={view} open={sidebarOpen} connected={Boolean(backend)} busy={navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} sessions={sessions} sessionsState={sessionsState} activeSessionId={storedSessionRef.current} onClose={() => setSidebarOpen(false)} onOpenView={openView} onNewChat={() => { if (openView('chat')) void newChat() }} onRefreshSessions={() => void loadSessions()} onResumeSession={id => { if (openView('chat')) void resumeSession(id) }} />
    <main className="workspace">
      <WorkspaceHeader view={view} sessionTitle={activeSession?.title} sessionSource={activeSession?.source} connected={Boolean(backend)} onOpenNavigation={() => setSidebarOpen(true)} />
    {view === 'workspaces' && <WorkspacesView connected={Boolean(backend)} busy={navigationBusy || sessionCreating || turnBusy || attachmentBusy || reasoningBusy || pickerBusy}
      paths={workspaces.paths} selected={workspaces.selected} onAdd={workspaces.add} onSelect={workspaces.select} onRemove={workspaces.remove}
      onNewChat={path => { if (openView('chat')) { workspaces.select(path); void newChat() } }} />}
    {view === 'tools' && <ToolsView connected={Boolean(backend)} sessionId={sessionId} />}
    {view === 'usage' && <UsageView connected={Boolean(backend)} />}
    {view === 'extensions' && <ExtensionsView connected={Boolean(backend)} />}
    {view === 'channels' && <ChannelsView connected={Boolean(backend)} onRestart={() => restartForChannel()} onForceRestart={() => restartForChannel(true)} />}
    {view === 'about' && <AboutView />}
    {view === 'memory' && <PersonalFilesView connected={Boolean(backend)} sessionId={sessionId} onDirtyChange={setPersonalFilesDirty} />}
    {view === 'agent' && <AgentSettingsView connected={Boolean(backend)} storagePath={storagePath} onDirtyChange={setAgentConfigDirty} onOpenModelSettings={() => openView('model')} />}
    {view === 'runtime' && <RuntimeView storagePath={storagePath} onStoragePathChange={setStoragePath} storageLocked={storageLocked} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} onChooseStoragePath={chooseStoragePath} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onStop={stopBackend} />}
    {view === 'model' && <ModelSettingsView connected={Boolean(backend)} language={language} t={t} controller={modelController} onOpenRuntime={() => openView('runtime')} />}
    {view === 'chat' && <ChatView connected={Boolean(backend)} backendStatus={backendStatus} language={language} t={t}
      controller={chatController} workspacePath={workspaces.selected} onOpenWorkspaces={() => openView('workspaces')} picker={{ modelButtonRef, modelPickerRef, pickerPosition, modelPickerOpen, setModelPickerOpen,
        activeModel, savedModel, pickerBusy, pickerError, pickerConfirmation, pickerProviders, pickerProvider, setPickerProvider,
        pickerModels, pickerModelInput, setPickerModelInput, openModelPicker, pickModel }}
      onOpenRuntime={() => openView('runtime')} onOpenModelSettings={() => openView('model')} />}
    </main>
  </div>
}

export default App
