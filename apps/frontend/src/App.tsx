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
import type { McpSetupDraft } from './features/extensions/model'
import ChatView from './features/chat/ChatView'
import ChatTabs from './features/chat/ChatTabs'
import BotsView from './features/bots/BotsView'
import { useChatController } from './features/chat/useChatController'
import { useChatTabs, chatTabKey, type ChatTab } from './features/chat/useChatTabs'
import { chatTabStatus as resolveChatTabStatus } from './features/chat/chatTabsState'
import { useSessionActivity } from './features/chat/useSessionActivity'
import { useSidebarSessions } from './features/chat/useSidebarSessions'
import ModelSettingsView from './features/models/ModelSettingsView'
import MainModelSettings from './features/models/MainModelSettings'
import MoaSettings from './features/models/MoaSettings'
import ModelRouteSettings from './features/agent-settings/ModelRouteSettings'
import MemoryContextSettings from './features/agent-settings/MemoryContextSettings'
import SettingsView from './features/settings/SettingsView'
import ProgrammingSettings from './features/programming/ProgrammingSettings'
import ProgrammingPermissionSettings from './features/programming/ProgrammingPermissionSettings'
import ProgrammingConfiguration from './features/programming/ProgrammingConfiguration'
import ProgrammingChat from './features/programming/ProgrammingChat'
import ProgrammingSessions from './features/programming/ProgrammingSessions'
import ProgrammingConfigFile from './features/programming/ProgrammingConfigFile'
import ProgrammingArchives from './features/programming/ProgrammingArchives'
import { useProgrammingController } from './features/programming/useProgrammingController'
import type { SettingsPage } from './features/settings/model'
import { useModelController } from './features/models/useModelController'
import RuntimeView from './features/runtime/RuntimeView'
import WebAccessSettings from './features/runtime/WebAccessSettings'
import StorageLocationSettings from './features/runtime/StorageLocationSettings'
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
import type { ActiveGateway, BackendInfo } from '@hermess/contracts'
import GatewayRecoveryNotice from './features/runtime/GatewayRecoveryNotice'
import { connectionLabel } from './features/runtime/connectionLabel'
import BotGroupConversation from './features/bots/BotGroupConversation'
import { useGroupRooms } from './features/bots/useGroupRooms'
import { useDesktop } from './app/DesktopContext'
import { useProfileState, workspaceKey } from './app/profile-scope/ProfileWorkspace'
import NotificationsSettings from './features/notifications/NotificationsSettings'
import { useNativeNotifications } from './features/notifications/useNativeNotifications'
import GatewayNoticesProvider from './features/notifications/GatewayNoticesProvider'
import { DashboardPluginPage, DashboardPluginSlot, useDashboardPlugins } from './features/dashboard-plugins/DashboardPluginHost'
import { dashboardBuiltinRoute, dashboardPageSlot, dashboardPluginForRoute, normalizeDashboardRoute } from './features/dashboard-plugins/dashboardRouteModel'
import type { ProfileTab } from './features/profiles/ProfileOverview'
import { describeError } from './app/desktopErrors'
import CommandPalette, { useCommandPalette } from './features/command-palette/CommandPalette'
import { paletteItems, type PaletteItem } from './features/command-palette/model'
import OnboardingDialog from './features/onboarding/OnboardingDialog'
import { useOnboarding } from './features/onboarding/useOnboarding'
import HostTerminals from './features/workspace-panel/HostTerminals'

function WorkspaceApp({ gateway, onRemote, onLocal, onOpenHostTerminals }: {
  gateway: ActiveGateway
  onRemote: (id: string) => Promise<boolean>
  onLocal: () => Promise<boolean>
  onOpenHostTerminals: () => void
}) {
  const remoteMode = gateway.mode === 'remote'
  const { chat, events, extensions, windowChrome, chatWindows } = useDesktop()
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(languageRef.current, key, ...values), [])
  const [view, setView] = React.useState<View>('chat')
  const [personalTaskTarget, setPersonalTaskTarget] = React.useState<{ profile: string; id: string } | null>(null)
  const [activeDashboardPlugin, setActiveDashboardPlugin] = React.useState<string | null>(null)
  const [dashboardReturnView, setDashboardReturnView] = React.useState<Exclude<View, 'dashboard-plugin'>>('chat')
  const [dashboardRouteRequest, setDashboardRouteRequest] = React.useState<string | null>(() => normalizeDashboardRoute(window.location.pathname))
  const [settingsPage, setSettingsPage] = React.useState<SettingsPage>('providers')
  const [programming, setProgramming] = React.useState(false)
  const [settingsReturnView, setSettingsReturnView] = React.useState<View>('chat')
  const [settingsDirty, setSettingsDirty] = React.useState(false)
  const [settingsBusy, setSettingsBusy] = React.useState(false)
  const [personalFilesDirty, setPersonalFilesDirty] = React.useState(false)
  const [profileMemoryOpen, setProfileMemoryOpen] = React.useState(false)
  const [profileFilesInitialTab, setProfileFilesInitialTab] = React.useState<'soul' | 'memory'>('memory')
  const [profileTab, setProfileTab] = React.useState<ProfileTab>('overview')
  const [profileTabRequest, setProfileTabRequest] = React.useState<{ id: number; tab: ProfileTab }>({ id: 0, tab: 'overview' })
  const [mcpSetup, setMcpSetup] = React.useState<{ profile: string; epoch: string | null; draft: McpSetupDraft } | null>(null)
  const [profileCreateOpen, setProfileCreateOpen] = React.useState(false)
  const [pendingLearnCommand, setPendingLearnCommand] = React.useState('')
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [activeGroupId, setActiveGroupId] = React.useState<string | null>(null)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [diagnosticsUnlocked, setDiagnosticsUnlocked] = React.useState(false)
  const updateStatus = useUpdateStatus()
  const workspaces = useWorkspaces()
  const programmingController = useProgrammingController(language, workspaces.selected, view === 'chat' && programming && !remoteMode)
  const restoreConnectionRef = React.useRef<(info: BackendInfo, current: () => boolean) => Promise<void>>(async () => {})
  const cancelConnectionRecoveryRef = React.useRef<() => void>(() => {})
  const {
    pythonPath, setPythonPath, storagePath, setStoragePath, storageLocked, freshInstallation,
    backend, setBackend, workspaceGeneration, backendStatus, setBackendStatus, busy, setBusy,
    startBackend, startBackendStrict, chooseStoragePath, pingBackend, stopBackend, stopBackendStrict,
    restartBackend, forceRestartBackend, enableWebAccess, connected, connectionState, reconnectBackend, suspendRecovery,
  } = useRuntimeController({
    t,
    onReset: () => { setActiveModel(null); resetChat(); resetModel() },
    gateway,
    onRestore: (info, current) => restoreConnectionRef.current(info, current),
    onCancelRestore: () => cancelConnectionRecoveryRef.current(),
  })
  const onboarding = useOnboarding(freshInstallation, storagePath)
  const commandPalette = useCommandPalette(!onboarding.visible)
  const profileController = useProfiles({
    connected, retainOffline: Boolean(backend),
    backendEpoch: backend?.replay_epoch || null,
    restart: () => restartBackend(),
  })
  const viewedProfile = profileController.snapshot?.selected || null
  const groupRooms = useGroupRooms(connected, backend?.replay_epoch || null, language)
  const dashboardPluginLifecycle = React.useMemo(() => ({ start: startBackendStrict, stop: stopBackendStrict, restart: restartBackend }), [startBackendStrict, stopBackendStrict, restartBackend])
  const dashboardPlugins = useDashboardPlugins(connected && !remoteMode, viewedProfile, backend?.replay_epoch || null, language, dashboardPluginLifecycle)
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
    backend, connected, remoteMode, profile: viewedProfile, chatVisible: view === 'chat' && !activeGroupId && !programming && !dashboardOverride, activeModel, language, storagePath, workspacePath: remoteMode ? '' : workspaces.selected, t,
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
    resetChat,
  } = chatController
  restoreConnectionRef.current = chatController.restoreConnection
  cancelConnectionRecoveryRef.current = chatController.cancelConnectionRecovery
  const connectionText = connectionLabel(connectionState, language)
  const gatewaySwitchPending = React.useRef(false)
  const [remoteSetupRequested, setRemoteSetupRequested] = React.useState(false)
  const switchGateway = async (id: string | null) => {
    if (gatewaySwitchPending.current) return
    const activeId = gateway.mode === 'remote' ? gateway.config.id : null
    if (id === activeId) { if (!connected) await reconnectBackend(); return }
    gatewaySwitchPending.current = true
    try {
      suspendRecovery()
      const switched = id === null ? await onLocal() : await onRemote(id)
      if (!switched) await reconnectBackend()
    }
    finally { gatewaySwitchPending.current = false }
  }
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
    loadModelOptions, openModelPicker, pickModel, restoreDefaultModel, resetModel, modelOptionsLoaded,
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
      setMcpSetup(null)
    }
    if (next !== 'dashboard-plugin') setDashboardRouteRequest(null)
    setView(next)
    setSidebarOpen(false)
    return true
  }
  const openNewChat = async (): Promise<boolean> => {
    if (!openView('chat')) return false
    setProgramming(false)
    if (!viewedProfile || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy) return false
    setActiveGroupId(null)
    if (!sessionId && !storedSessionRef.current) return true
    const blank = chatTabs.tabs.find(tab => !tab.id)
    if (blank) return selectChatTab(blank)
    await newChat(true)
    return !storedSessionRef.current
  }
  const openDashboardPlugin = (name: string): boolean => {
    if (!openView('dashboard-plugin')) return false
    if (view !== 'dashboard-plugin' && !(view === 'settings' && settingsReturnView === 'dashboard-plugin')) {
      setDashboardReturnView(view)
    }
    setActiveDashboardPlugin(name)
    console.info('[dashboard-plugin] page opened', { plugin: name, from: view })
    return true
  }
  const returnFromDashboardPlugin = () => {
    if (!openView(dashboardReturnView)) return
    if (dashboardReturnView === 'profiles') setProfileTabRequest(current => ({ id: current.id + 1, tab: profileTab }))
    console.info('[dashboard-plugin] page returned', { plugin: activeDashboardPlugin, to: dashboardReturnView })
  }
  React.useEffect(() => {
    const activateLocation = () => setDashboardRouteRequest(normalizeDashboardRoute(window.location.pathname))
    window.addEventListener('popstate', activateLocation)
    return () => window.removeEventListener('popstate', activateLocation)
  }, [])
  React.useEffect(() => {
    if (!dashboardRouteRequest) return
    const plugin = dashboardPluginForRoute(dashboardPlugins.manifests, dashboardRouteRequest)
    if (plugin) openDashboardPlugin(plugin.name)
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
    target: !remoteMode && connected && backend && viewedProfile ? { profile: viewedProfile, sessionId: storedSessionRef.current || '', epoch: backend.replay_epoch, busy: turnBusy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || settingsBusy || settingsDirty || personalFilesDirty || Boolean(chatController.draft.trim()) || chatController.attachments.length > 0 } : null,
    send: async text => { if (!openView('chat')) return false; setActiveGroupId(null); return Boolean(await chatController.sendMessage(text, true)) },
  })
  const activeSession = sessions.find(session => session.id === storedSessionRef.current)
  const [otherProfileSessions, setOtherProfileSessions] = useProfileState<Record<string, SessionRow[]>>(workspaceKey(backend?.replay_epoch, 'sidebar-other'), {}, 'app:other-profile-sessions')
  const sidebarSessions = useSidebarSessions(backend?.replay_epoch, viewedProfile, sessions, sessionsState, otherProfileSessions)
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
    storedSessionRef.current, sessionId, serverRequests, view === 'chat' && !activeGroupId && !programming, turnBusy, refreshSessionActivity,
  )
  commandFinishedRef.current = settleCommand
  const openProfileSession = async (profile: string, id: string) => {
    if (!openView('chat')) return false
    setProgramming(false)
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
    setProgramming(false)
    setActiveGroupId(roomId)
  }
  const selectChatTab = async (tab: ChatTab): Promise<boolean> => {
    if (chatTabKey(tab) === chatTabs.currentKey) { setProgramming(false); return true }
    if (tab.id) return openProfileSession(tab.profile, tab.id)
    if (!openView('chat')) return false
    setProgramming(false)
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
  const chatTabStatus = (tab: ChatTab) => {
    const row = (tab.profile === viewedProfile ? sessions : otherProfileSessions[tab.profile] || []).find(item => item.id === tab.id)
    return resolveChatTabStatus(tab, connected, sessionActivity[activityKey(tab.profile, tab.id)],
      chatTabKey(tab) === chatTabs.currentKey, turnBusy, Boolean(row?.running))
  }
  const closeChatTabs = async (targets: ChatTab[]) => {
    if (navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || !viewedProfile || !connected) return
    const operation = crypto.randomUUID()
    console.info('[chat-tabs] batch close started', { operation, count: targets.length })
    try {
      let fallback: ChatTab | undefined
      if (targets.some(tab => chatTabKey(tab) === chatTabs.currentKey)) {
        if (storedSessionRef.current) await newChat(true, false, true)
        if (storedSessionRef.current) {
          console.error('[chat-tabs] batch close blocked', { operation, reason: 'active-session-unchanged' })
          setChatStatus(language === 'zh-CN' ? '当前操作尚未结束，请稍后重试关闭标签。' : 'Please wait for the current operation before closing tabs.')
          return
        }
        fallback = { profile: viewedProfile, id: '' }
      }
      chatTabs.closeMany(targets, fallback)
      console.info('[chat-tabs] batch close completed', { operation, count: targets.length, blankRetained: Boolean(fallback) })
    } catch {
      console.error('[chat-tabs] batch close failed', { operation })
      setChatStatus(language === 'zh-CN' ? '关闭标签失败，请重试。' : 'Failed to close tabs. Try again.')
    }
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
  usePersonalTaskEvents(connected && !remoteMode, backend?.replay_epoch || null, storagePath || '', profileController.snapshot, target => {
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
    language, connected, diagnosticsUnlocked, selectedProfile: viewedProfile,
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
    if (target.kind === 'plugin') return openDashboardPlugin(target.name)
    if (target.kind === 'session') return openProfileSession(target.profile, target.id)
    if (target.id === 'new-chat') return openNewChat()
    if (!backend) return false
    await Promise.all([loadSessions(true), refreshOtherProfileSessions()])
    return true
  }
  const openProgramming = async (id?: string, directory?: string, projectId?: string) => {
    if (remoteMode || programmingController.busy || !openView('chat')) return
    setActiveGroupId(null)
    setProgramming(true)
    let loaded = false
    await programmingController.run(async () => { await programmingController.refresh(); loaded = true })
    if (!loaded) return
    if (id) await programmingController.select(id)
    else programmingController.newSession(directory, projectId)
  }
  return <div className={`app-shell ${windowChrome.customTitlebar ? 'custom-titlebar-shell' : ''} ${view === 'profiles' ? 'profile-page-shell' : ''} ${view === 'settings' ? 'settings-shell' : ''}`}>
    <div className="dashboard-plugin-backdrop" aria-hidden="true"><DashboardPluginSlot name="backdrop" /></div>
    <WorkspaceHeader view={view} sessionTitle={programming && !remoteMode ? programmingController.session?.title || (language === 'zh-CN' ? '新编程会话' : 'New programming chat') : activeGroupId ? groupRooms.rooms.find(room => room.room_id === activeGroupId)?.name : activeSession?.title} sessionSource={activeGroupId || programming ? undefined : activeSession?.source} pluginTitle={dashboardManifest?.label} connected={connected} connectionLabel={connectionText} gateway={gateway} updateVersion={updateStatus.candidate?.asset ? updateStatus.candidate.version : null} onOpenNavigation={() => setSidebarOpen(true)} onOpenView={next => { if (next === 'settings' && !remoteMode) openSettings(); else if (!remoteMode) { if (next === 'personal-tasks') setPersonalTaskTarget(null); openView(next) } }} onOpenUpdate={() => { if (!remoteMode) openSettings('update') }} onOpenCommandPalette={commandPalette.show} onSwitchGateway={id => void switchGateway(id)} onConfigureRemote={() => { if (openSettings('runtime')) setRemoteSetupRequested(true) }} onOpenHostTerminals={onOpenHostTerminals} />
    <CommandPalette open={commandPalette.open} language={language} items={commandItems} onClose={commandPalette.close} onExecute={executeCommand} />
    <DashboardPluginSlot name="header-banner" />
    {view !== 'settings' && <Sidebar view={view} open={sidebarOpen} connected={connected} connectionLabel={connectionText} remoteMode={remoteMode} busy={!connected || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} sessions={sessions} otherProfileSessions={sidebarSessions} groups={groupRooms.rooms} groupsError={groupRooms.error} activeGroupId={activeGroupId} sessionActivity={sessionActivity} activityKey={activityKey} sessionsState={sessionsState} activeSessionId={programming ? '' : storedSessionRef.current} programmingActive={view === 'chat' && programming} onSwitchMode={mode => {
      if (remoteMode || !openView('chat')) return false
      if (mode === 'code') setActiveGroupId(null)
      setProgramming(mode === 'code')
      console.info('[workspace] conversation mode switched', { mode, target: mode === 'chat' ? 'chat' : programmingController.session ? 'session' : programmingController.draftVisible ? 'draft' : 'directories' })
      return true
    }} programmingSessions={<ProgrammingSessions controller={programmingController} language={language} active={view === 'chat' && programming} onOpen={(id, directory, projectId) => { void openProgramming(id, directory, projectId) }} />} onClose={() => setSidebarOpen(false)} onOpenView={next => { if (remoteMode) { if (next === 'bots' || next === 'sessions' || next === 'chat') openView(next) } else if (next === 'runtime') openSettings('runtime'); else if (next === 'about') openSettings('about'); else { if (next === 'personal-tasks') setPersonalTaskTarget(null); openView(next) } }} onNewChat={() => { void openNewChat() }} onNewGroup={() => { openView('bots') }} onOpenGroup={openGroup} onRefreshGroups={() => { void groupRooms.refresh() }} onResumeSession={(profile, id) => { void openProfileSession(profile, id) }} onArchiveSession={archiveProfileSession} onDeleteSession={deleteProfileSession}
      profiles={profileController.snapshot} profileBusy={!connected || profileController.busy || navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || pickerBusy} profileError={profileController.error} profilePendingRestart={profileController.pendingRestart}
      onRetryProfile={() => void profileController.retryPending()}
      onOpenProfile={name => {
        setProfileTab('overview')
        setProfileCreateOpen(false)
        setProfileTabRequest(current => ({ id: current.id + 1, tab: 'overview' }))
        if (openView('profiles') && profileController.snapshot?.selected !== name) void profileController.select(name).catch(() => {})
      }} dashboardPlugins={dashboardPlugins.manifests} activeDashboardPlugin={activeDashboardPlugin} onOpenDashboardPlugin={openDashboardPlugin} />}
    <main className="workspace">
    <GatewayRecoveryNotice state={connectionState} message={backendStatus} onRetry={reconnectBackend} />
    <DashboardPluginSlot name="pre-main" />
    {dashboardSlotPage && <DashboardPluginSlot name={`${dashboardSlotPage}:top`} />}
    {dashboardOverride ? <DashboardPluginPage manifest={dashboardOverride} component={dashboardPlugins.components.get(dashboardOverride.name)} error={dashboardPlugins.error} /> : <>
    {view === 'bots' && <BotsView active={view === 'bots'} connected={connected} language={language} gatewayMode={remoteMode ? 'remote' : 'local'} onOpenChat={(profile, id) => { void openProfileSession(profile, id) }} onOpenGroup={openGroup} onGroupsChanged={() => { void groupRooms.refresh() }} onOpenProfiles={() => { if (!remoteMode) openView('profiles') }} />}
    {view === 'files' && <FilesView connected={connected} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} initialRoot={workspaces.selected} onSelectProfile={name => profileController.select(name)} />}
    {view === 'workspaces' && <WorkspacesView connected={connected} busy={navigationBusy || sessionCreating || turnBusy || attachmentBusy || reasoningBusy || pickerBusy}
      paths={workspaces.paths} selected={workspaces.selected} onAdd={workspaces.add} onSelect={workspaces.select} onRemove={workspaces.remove}
      onNewChat={path => { if (openView('chat')) { workspaces.select(path); void openNewChat() } }} />}
    {view === 'scheduled' && <ScheduledTasksView key={workspaceGeneration} connected={connected} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot} />}
    {view === 'personal-tasks' && <KanbanBoardView initialTaskId={personalTaskTarget?.id} connectionId={backend?.replay_epoch || null} storagePath={storagePath} />}
    {view === 'dashboard-plugin' && <DashboardPluginPage manifest={dashboardManifest} component={activeDashboardPlugin ? dashboardPlugins.components.get(activeDashboardPlugin) : undefined} error={dashboardPlugins.error} onBack={returnFromDashboardPlugin} />}
    {view === 'webhooks' && <WebhooksView connected={connected} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} onRestart={() => restartBackend().then(Boolean)} />}
    {view === 'usage' && <UsageView connected={connected} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onOpenConfiguration={() => openSettings('advanced-config')} onOpenModelSettings={page => openSettings(page)} />}
    {view === 'journey' && <JourneyView key={`${profileController.snapshot?.selected || ''}:${backend?.replay_epoch || ''}`} connected={connected} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} />}
    {view === 'extensions' && <ExtensionsView connected={connected} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} profileBusy={profileController.busy}
      onCreateProfile={profileController.create} onConfigureMcp={async (profile, draft) => {
        const served = profileController.snapshot?.gateways.some(gateway => gateway.profile === profile || gateway.served_profiles?.includes(profile))
        if (!connected || !served) return false
        await profileController.select(profile)
        if (!openView('profiles')) return false
        setMcpSetup({ profile, epoch: backend?.replay_epoch || null, draft })
        return true
      }} />}
    {view === 'profiles' && <ProfilesView connected={connected} epoch={backend?.replay_epoch || null} profiles={profileController.snapshot} activeProfile={profileController.activeProfile} tabRequest={profileTabRequest} onTabChange={setProfileTab} onCreateOpenChange={setProfileCreateOpen}
      mcpSetup={mcpSetup && mcpSetup.profile === viewedProfile && mcpSetup.epoch === (backend?.replay_epoch || null) ? mcpSetup.draft : undefined}
      onMcpSetupApplied={() => setMcpSetup(null)}
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
        setMcpSetup(null)
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
    {view === 'channels' && <ChannelsView connected={connected} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onRestart={() => restartForChannel()} onForceRestart={() => restartForChannel(true)} />}
    {view === 'about' && <AboutView updateStatus={updateStatus} />}
    {view === 'memory' && <PersonalFilesView connected={connected} profile={profileController.snapshot?.selected || null} epoch={backend?.replay_epoch || null} onDirtyChange={setPersonalFilesDirty} />}
    {view === 'settings' && <SettingsView language={language} page={settingsPage} connected={connected} profile={viewedProfile} profiles={profileController.snapshot?.profiles || []} profileBusy={profileController.busy || settingsBusy} diagnosticsUnlocked={diagnosticsUnlocked}
      onOpenOnboarding={() => { if (openView('chat')) onboarding.reopen() }}
      onSelectProfile={async name => { if (name === viewedProfile) return true; if (settingsBusy) return false; if (settingsDirty && !window.confirm(t('ui.you.have.unsaved.settings.discard.changes'))) return false; modelController.discardSettingsDraft(); await profileController.select(name); setSettingsDirty(false); return true }}
      onNavigate={page => openSettings(page)}
      onExit={() => { if (openView(settingsReturnView)) { setSettingsDirty(false); onboarding.resume() } }}>
      {(settingsPage === 'sessions' || settingsPage === 'archived-sessions') && <SessionsView key={settingsPage} archivedOnly={settingsPage === 'archived-sessions'} connected={connected} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} onOpenSession={async (profile, id) => { await openProfileSession(profile, id) }} onDeleteSession={deleteProfileSession} />}
      {settingsPage === 'programming-config-file' && <ProgrammingConfigFile language={language} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} onSaved={programmingController.retryPermissions} />}
      {settingsPage === 'programming-archives' && <ProgrammingArchives controller={programmingController} language={language} />}
      {settingsPage === 'local-tools' && <ToolsView connected={connected} epoch={backend?.replay_epoch || null} generation={workspaceGeneration} onRestart={() => restartBackend().then(Boolean)} />}
      {isConfigurationPage(settingsPage) && <ConfigurationSettings key={backend?.replay_epoch + ':' + viewedProfile + ':' + settingsPage} connected={connected} profile={viewedProfile} page={settingsPage} language={language} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} onNavigate={page => { openSettings(page) }} />}
      {(settingsPage === 'device' || settingsPage === 'quick-input') && <DeviceSettings page={settingsPage} language={language} />}
      {settingsPage === 'delegation' && <DelegationSettings key={backend?.replay_epoch + ':' + viewedProfile} connected={connected} profile={viewedProfile} language={language} providers={modelController.providerCards.map(provider => ({ ...provider, models: modelController.visibleModels(provider.slug) }))} onOpenAuxiliary={() => openSettings('auxiliary')} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {settingsPage === 'providers' && <ModelSettingsView connected={connected} profile={viewedProfile} language={language} t={t} controller={modelController} onOpenRuntime={() => openSettings('runtime')} onOpenMain={() => openSettings('main')} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {settingsPage === 'credential-pool' && <CredentialPoolSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={connected} profile={viewedProfile} language={language} />}
      {settingsPage === 'pairing' && <PairingView connected={connected} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} />}
      {settingsPage === 'logs' && <LogsView connected={connected} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} />}
      {settingsPage === 'env-keys' && <EnvKeysView connected={connected} profile={viewedProfile} profiles={profileController.snapshot} epoch={backend?.replay_epoch || null} onSelectProfile={name => profileController.select(name)} onOpenModels={() => openSettings('providers')} onOpenChannels={() => openView('channels')} />}
      {settingsPage === 'main' && <MainModelSettings key={viewedProfile || ''} connected={connected} profile={viewedProfile} language={language} controller={modelController} epoch={backend?.replay_epoch || null} onOpenProviders={() => openSettings('providers')} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {settingsPage === 'moa' && <MoaSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'unselected'}`} connected={connected} profile={viewedProfile} language={language}
        providers={modelController.providerCards.filter(provider => modelController.configuredProviders.some(configured => configured.slug === provider.slug)
          || modelController.customEndpoints.some(endpoint => endpoint.id === provider.slug && endpoint.source !== 'direct-config'))
          .map(provider => ({ ...provider, models: modelController.visibleModels(provider.slug) }))}
        onOpenProviders={() => openSettings('providers')} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {(settingsPage === 'fallbacks' || settingsPage === 'auxiliary') && <ModelRouteSettings key={`${viewedProfile}:${settingsPage}:${settingsPage === 'auxiliary' ? backend?.replay_epoch || 'offline' : ''}`} page={settingsPage} connected={connected} profile={viewedProfile} epoch={backend?.replay_epoch || null} storagePath={storagePath} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {(settingsPage === 'memory-persistent' || settingsPage === 'memory-context') && <MemoryContextSettings
        key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'unselected'}:${settingsPage}`}
        page={settingsPage} connected={connected} profile={viewedProfile} language={language} onOpenAuxiliary={() => openSettings('auxiliary')}
        onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {(settingsPage === 'notification-alerts' || settingsPage === 'notification-sounds') && <NotificationsSettings page={settingsPage === 'notification-alerts' ? 'alerts' : 'sounds'} language={language} />}
      {settingsPage === 'web-access' && <WebAccessSettings gatewayPid={backend?.pid} busy={busy} onEnable={enableWebAccess} />}
      {(settingsPage === 'runtime' || settingsPage === 'runtime-status' || settingsPage === 'runtime-backup') && <RuntimeView connected={connected} connectionLabel={connectionText} reconnecting={connectionState === 'reconnecting'} page={settingsPage} storagePath={storagePath} onStoragePathChange={setStoragePath} storageLocked={storageLocked} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} profiles={profileController.snapshot} onChooseStoragePath={chooseStoragePath} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onRestart={restartBackend} onStop={stopBackend} onConnectRemote={switchGateway} remoteSetupRequested={remoteSetupRequested} onRemoteSetupOpened={() => setRemoteSetupRequested(false)} />}
      {settingsPage === 'diagnostics' && <DiagnosticsView storagePath={storagePath} pythonPath={pythonPath} onPythonPathChange={setPythonPath} backend={backend} backendStatus={backendStatus} busy={busy} onStart={startBackend} onPing={pingBackend} onReconnect={reconnectBackend} onStop={stopBackend} />}
      {settingsPage === 'shell-hooks' && <ShellHooksSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={connected} profile={viewedProfile} language={language} />}
      {settingsPage === 'curator' && <CuratorSettings key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={connected} profile={viewedProfile} language={language} />}
      {settingsPage === 'system-operations' && <SystemOperations key={`${backend?.replay_epoch || 'offline'}:${viewedProfile || 'none'}`} connected={connected} profile={viewedProfile} language={language} />}
      {settingsPage === 'update' && <UpdateView updateStatus={updateStatus} />}
      {(settingsPage === 'programming-mcp' || settingsPage === 'programming-skills' || settingsPage === 'programming-instructions' || settingsPage === 'programming-context') && <ProgrammingConfiguration onOpenConfig={() => openSettings('programming-config-file')} key={settingsPage} page={settingsPage} language={language} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} onSaved={programmingController.retryPermissions} />}
      {settingsPage === 'programming-permissions' && <ProgrammingPermissionSettings onOpenConfig={() => openSettings('programming-config-file')} language={language} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} onSaved={programmingController.retryPermissions} />}
      {settingsPage === 'programming' && <ProgrammingSettings onCatalogChange={programmingController.applyCatalog} providers={modelController.modelProviders} language={language} profiles={profileController.snapshot?.profiles || []} connected={connected} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />}
      {settingsPage === 'documentation' && <DocumentationView />}
      {settingsPage === 'about' && <AboutView updateStatus={updateStatus} />}
    </SettingsView>}
    {view === 'chat' && activeGroupId && <BotGroupConversation key={activeGroupId} roomId={activeGroupId} connected={connected} language={language} onDisband={() => { setActiveGroupId(null); void groupRooms.refresh() }} />}
    {!remoteMode && programming && <div className="chat-workspace-layout" style={view === 'chat' ? undefined : { display: 'none' }}><ProgrammingChat onOpenSettings={target => openSettings(target === 'permissions' ? 'programming-permissions' : 'programming')} language={language} controller={programmingController} /></div>}
    <div className="chat-workspace-layout" style={view === 'chat' && !activeGroupId && !programming ? undefined : { display: 'none' }}><ChatView runtimeAvailable={Boolean(backend)} active={view === 'chat' && !activeGroupId && !programming} connected={connected} backendStatus={backendStatus} language={language} t={t} remoteMode={remoteMode}
      tabs={<ChatTabs tabs={chatTabs.tabs} activeKey={chatTabs.currentKey} disabled={navigationBusy || sessionCreating || attachmentBusy || reasoningBusy || !connected} language={language}
        status={chatTabStatus} onCloseMany={tabs => { void closeChatTabs(tabs) }}
        title={tab => tab.id ? (tab.profile === viewedProfile ? sessions : otherProfileSessions[tab.profile] || []).find(item => item.id === tab.id)?.title || tab.id.slice(0, 12) : language === 'zh-CN' ? '新聊天' : 'New chat'}
        onSelect={tab => { void selectChatTab(tab) }} onClose={tab => { void closeChatTab(tab) }} onOpenWindow={tab => { void chatWindows.open(tab.profile, tab.id).catch(cause => setChatStatus(describeError(cause, language))) }} onNew={() => { void openNewChat() }} />}
      scrollKey={chatTabs.currentKey}
      controller={chatController} workspacePath={remoteMode ? '' : workspaces.selected} onOpenWorkspaces={() => { if (!remoteMode) openView('workspaces') }}
      panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(value => !value)}
      profiles={profileController.snapshot} profileBusy={profileController.busy} onSelectProfile={name => { void profileController.select(name).catch(() => {}) }} picker={{ modelButtonRef, modelPickerRef, pickerPosition, modelPickerOpen, setModelPickerOpen,
        activeModel, savedModel, pickerBusy, pickerError, pickerConfirmation, pickerProviders, pickerProvider, setPickerProvider,
        pickerModels, pickerModelInput, setPickerModelInput, openModelPicker, pickModel, restoreDefaultModel }}
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
    {!remoteMode && onboarding.visible && <OnboardingDialog language={language} step={onboarding.step} connected={connected} runtimeBusy={busy} runtimeStatus={backendStatus} profile={viewedProfile} model={savedModel?.model || null}
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
  const [hostTerminalsOpen, setHostTerminalsOpen] = React.useState(false)
  const [switchError, setSwitchError] = React.useState('')
  const [storageBlocked, setStorageBlocked] = React.useState(false)
  React.useEffect(() => {
    let live = true
    void Promise.all([runtime.activeGateway().catch(error => {
      if (live) setSwitchError(describeError(error, language))
      return { mode: 'local' } as ActiveGateway
    }), runtime.storageLocation({ action: 'get' })]).then(([value, storage]) => {
      if (live) { setStorageBlocked(storage.blocked); setGateway(value) }
    })
      .catch(error => { if (live) { setSwitchError(describeError(error, language)); setStorageBlocked(true); setGateway({ mode: 'local' }) } })
    return () => { live = false }
  }, [runtime, language])
  const switchRemote = async (id: string) => {
    setSwitchError('')
    try {
      const active = await runtime.activateSavedRemote(id)
      setGateway(active)
      return true
    } catch (error) { setSwitchError(describeError(error, language)); return false }
  }
  const switchLocal = async () => {
    setSwitchError('')
    try {
      const active = await runtime.activateLocalGateway()
      setGateway(active)
      return true
    }
    catch (error) { setSwitchError(describeError(error, language)); return false }
  }
  return <GatewayNoticesProvider>
    {storageBlocked ? <div className="app-shell"><main className="settings-panel"><StorageLocationSettings /></main></div> : gateway ? <WorkspaceApp key={gateway.mode === 'remote' ? `remote:${gateway.config.id}:${gateway.replay_epoch}` : 'local'} gateway={gateway} onRemote={switchRemote} onLocal={switchLocal} onOpenHostTerminals={() => setHostTerminalsOpen(true)} />
      : <div className="app-shell"><div className="chat-gate" role="status">{language === 'zh-CN' ? '正在读取 Gateway 连接…' : 'Loading gateway connection…'}</div></div>}
    {switchError && <div className="gateway-switch-error" role="alert">{switchError}<button type="button" onClick={() => setSwitchError('')}>×</button></div>}
    {gateway && !storageBlocked && <HostTerminals open={hostTerminalsOpen} onHide={() => setHostTerminalsOpen(false)} />}
  </GatewayNoticesProvider>
}

export default App
