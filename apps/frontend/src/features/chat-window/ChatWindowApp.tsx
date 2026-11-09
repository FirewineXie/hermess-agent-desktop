import React from 'react'
import type { ChatWindowContext } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useLanguage, translateApp } from '../../i18n'
import { describeError } from '../../app/desktopErrors'
import { useChatController } from '../chat/useChatController'
import ChatView from '../chat/ChatView'
import { useModelController } from '../models/useModelController'
import type { ModelPick } from '../models/model'
import '../../style.css'
import './chat-window.css'

export default function ChatWindowApp() {
  const { chatWindows, events, windowChrome } = useDesktop()
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(languageRef.current, key, ...values), [])
  const [context, setContext] = React.useState<ChatWindowContext | null>(null)
  const [backendStatus, setBackendStatus] = React.useState(language === 'zh-CN' ? '正在连接主窗口…' : 'Connecting to the main window…')
  const [loadError, setLoadError] = React.useState('')
  const [retry, setRetry] = React.useState(0)
  const [activeModel, setActiveModel] = React.useState<ModelPick | null>(null)
  const [, setBusy] = React.useState(false)
  const attempt = React.useRef('')
  const lastContextError = React.useRef('')
  const loadContext = React.useCallback(async () => {
    try {
      const snapshot = await chatWindows.context()
      if (lastContextError.current) setLoadError('')
      lastContextError.current = ''
      setContext(snapshot)
      if (!snapshot.backend) setBackendStatus(languageRef.current === 'zh-CN' ? '主窗口运行时未连接，正在等待恢复…' : 'Waiting for the main window runtime to reconnect…')
    } catch (cause) {
      setContext(current => current && { ...current, backend: null })
      setLoadError(describeError(cause, languageRef.current))
      const errorType = cause instanceof Error ? cause.name : 'unknown'
      if (lastContextError.current !== errorType) console.error('[chat-window] context failed', { errorType })
      lastContextError.current = errorType
    }
  }, [chatWindows])

  React.useEffect(() => {
    void loadContext()
    const onFocus = () => void loadContext()
    window.addEventListener('focus', onFocus)
    let unlisten: (() => void) | undefined
    let active = true
    void events.onDisconnect(() => {
      if (!active) return
      attempt.current = ''
      setContext(current => current && { ...current, backend: null })
      setBackendStatus(languageRef.current === 'zh-CN' ? '连接中断，正在等待主窗口恢复…' : 'Connection lost. Waiting for the main window…')
      console.error('[chat-window] gateway disconnected')
    }).then(stop => { if (active) unlisten = stop; else stop() })
    return () => { active = false; unlisten?.(); window.removeEventListener('focus', onFocus) }
  }, [events, loadContext])
  React.useEffect(() => {
    if (context?.backend) return
    const timer = window.setInterval(() => void loadContext(), 2500)
    return () => window.clearInterval(timer)
  }, [context?.backend?.replay_epoch, loadContext])

  const backend = context?.backend || null
  const profile = context?.target.profile || null
  const storagePath = context?.storagePath || ''
  const chatController = useChatController({
    backend, profile, chatVisible: true, activeModel, language, storagePath, workspacePath: '', t,
    openChat: () => {}, openModelSettings: () => setBackendStatus(languageRef.current === 'zh-CN' ? '请在主窗口配置模型。' : 'Configure models in the main window.'),
    openCommandPage: () => false, onBackgroundStarted: () => {}, onCommandFinished: () => {},
    setSidebarOpen: () => {}, setActiveModel, setModelPickerOpen: value => modelController.setModelPickerOpen(value),
    setBackend: next => setContext(current => current && { ...current, backend: next }), setBackendStatus, setBusy,
  })
  const modelController = useModelController({
    backend, profile, storagePath, t, sessionRef: chatController.sessionRef,
    sessionProfileRef: chatController.sessionProfileRef, turnBusy: chatController.turnBusy,
    setChatStatus: chatController.setChatStatus, setActiveModel,
  })
  React.useEffect(() => {
    if (backend && profile) void modelController.loadModelOptions()
  }, [backend?.replay_epoch, profile])
  React.useEffect(() => {
    if (!backend || !profile || !context) return
    const key = `${backend.replay_epoch}\u0000${profile}\u0000${context.target.sessionId}\u0000${retry}`
    if (attempt.current === key) return
    attempt.current = key
    let active = true
    setLoadError('')
    console.info('[chat-window] resume started', { profile, epoch: backend.replay_epoch })
    void chatController.resumeSession(context.target.sessionId, true, backend.replay_epoch, profile).then(ok => {
      if (!active) return
      if (!ok) setLoadError(languageRef.current === 'zh-CN' ? '会话恢复失败。请检查主窗口连接后重试。' : 'Could not restore the session. Check the main window and retry.')
      else setBackendStatus('')
      if (ok) console.info('[chat-window] resume completed', { profile, epoch: backend.replay_epoch })
      else console.error('[chat-window] resume failed', { profile, epoch: backend.replay_epoch })
    })
    return () => { active = false }
  }, [backend?.replay_epoch, profile, context?.target.sessionId, retry])

  const picker = modelController
  return <div className="chat-window-shell">
    <header className="chat-window-header"><strong>Hermess Chat</strong><span>{profile || '—'}</span><button type="button" onClick={() => void windowChrome.close().catch(cause => setLoadError(describeError(cause, language)))}>{language === 'zh-CN' ? '关闭窗口' : 'Close window'}</button></header>
    {loadError && <div className="chat-window-notice" role="alert">{loadError}<button type="button" onClick={() => { setLoadError(''); setRetry(value => value + 1); void loadContext() }}>{language === 'zh-CN' ? '重试' : 'Retry'}</button></div>}
    <ChatView standalone active connected={Boolean(backend)} backendStatus={backendStatus} language={language} t={t}
      controller={chatController} workspacePath="" onOpenWorkspaces={() => {}} panelOpen={false} onTogglePanel={() => {}}
      profiles={null} profileBusy={false} onSelectProfile={() => {}} tabs={null} scrollKey={context?.target.sessionId || ''}
      onOpenRuntime={() => setBackendStatus(language === 'zh-CN' ? '请在主窗口启动运行时。' : 'Start the runtime in the main window.')}
      onOpenModelSettings={() => setBackendStatus(language === 'zh-CN' ? '请在主窗口配置模型。' : 'Configure models in the main window.')}
      onOpenDiagnostics={() => {}}
      picker={{ modelButtonRef: picker.modelButtonRef, modelPickerRef: picker.modelPickerRef, pickerPosition: picker.pickerPosition,
        modelPickerOpen: picker.modelPickerOpen, setModelPickerOpen: picker.setModelPickerOpen, activeModel,
        savedModel: picker.savedModel, pickerBusy: picker.pickerBusy, pickerError: picker.pickerError,
        pickerConfirmation: picker.pickerConfirmation, pickerProviders: picker.pickerProviders,
        pickerProvider: picker.pickerProvider, setPickerProvider: picker.setPickerProvider, pickerModels: picker.pickerModels,
        pickerModelInput: picker.pickerModelInput, setPickerModelInput: picker.setPickerModelInput,
        openModelPicker: picker.openModelPicker, pickModel: picker.pickModel, restoreDefaultModel: picker.restoreDefaultModel }} />
  </div>
}
