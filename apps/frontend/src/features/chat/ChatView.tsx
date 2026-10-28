import React from 'react'
import { VoiceRecorderButton } from '../voice/VoiceControls'
import { useChainedVoiceConversation } from '../voice/useChainedVoiceConversation'
import { useDesktop } from '../../app/DesktopContext'
import type { ModelProvider, ProfilesSnapshot } from '@hermess/contracts'
import type { ModelPick, SavedModel } from '../models/model'
import { localizeAppMessage } from '../../i18n'
import type { useChatController } from './useChatController'
import GatewayRequestCard from './components/GatewayRequestCard'
import MessageList from './components/MessageList'
import AttachmentQueue from './components/AttachmentQueue'
import CommandSuggestions from './components/CommandSuggestions'
import ContextUsageIndicator from './components/ContextUsageIndicator'
import ModelPicker from './components/ModelPicker'
import type { TimelineItem } from './timeline'

type Picker = {
  modelButtonRef: React.RefObject<HTMLButtonElement | null>
  modelPickerRef: React.RefObject<HTMLDivElement | null>
  pickerPosition: React.CSSProperties
  modelPickerOpen: boolean
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  activeModel: ModelPick | null
  savedModel: SavedModel | null
  pickerBusy: boolean
  pickerError: string
  pickerConfirmation: { provider: string; model: string; remember: boolean; token: string; message: string } | null
  pickerProviders: ModelProvider[]
  pickerProvider: string
  setPickerProvider: React.Dispatch<React.SetStateAction<string>>
  pickerModels: string[]
  pickerModelInput: string
  setPickerModelInput: React.Dispatch<React.SetStateAction<string>>
  openModelPicker: (refresh?: boolean) => Promise<void>
  pickModel: (provider: string, model: string, remember?: boolean, confirm?: string) => Promise<void>
}

type Props = {
  connected: boolean
  visible: boolean
  remote: boolean
  connectionKey: string
  backendStatus: string
  language: 'zh-CN' | 'en-US'
  t: (key: string, ...values: unknown[]) => string
  controller: ReturnType<typeof useChatController>
  workspacePath: string
  onOpenWorkspaces: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  picker: Picker
  onOpenRuntime: () => void
  onOpenModelSettings: () => void
  profiles: ProfilesSnapshot | null
  profileBusy: boolean
  onSelectProfile: (name: string) => void
}

export default function ChatView({ connected, visible, remote, connectionKey, backendStatus, language, t, controller, workspacePath, onOpenWorkspaces, panelOpen, onTogglePanel, picker, onOpenRuntime, onOpenModelSettings, profiles, profileBusy, onSelectProfile }: Props) {
  const { agentSettings, voice } = useDesktop()
  const backend = connected
  const openView = (view: 'runtime' | 'model') => view === 'runtime' ? onOpenRuntime() : onOpenModelSettings()
  const {
    draft, setDraft, commandCatalog, commandCatalogError, activeChoice, setActiveChoice, sessionId, sessionWorkspacePath,
    setDraftCaret, draftInputRef, conversation, assistant, chatStatus, setChatStatus, turnBusy, canContinue, navigationBusy,
    serverRequest, clarifyAnswers, setClarifyAnswer, attachments, attachmentBusy,
    draggingFiles, trigger, choices, answerRequest, changeReasoning, chooseCommand,
    chooseAttachments, removeAttachment, sendMessage, interruptSession, reasoningEffort,
    reasoningBusy, reasoningLoadFailed, chatUsage,
  } = controller
  const {
    modelButtonRef, modelPickerRef, pickerPosition, modelPickerOpen, setModelPickerOpen,
    activeModel, savedModel, pickerBusy, pickerError, pickerConfirmation, pickerProviders,
    pickerProvider, setPickerProvider, pickerModels, pickerModelInput, setPickerModelInput,
    openModelPicker, pickModel,
  } = picker
  const contentRef = React.useRef<HTMLDivElement>(null)
  const followMessagesRef = React.useRef(true)
  const lastUserCountRef = React.useRef(0)
  const lastSessionRef = React.useRef(sessionId)
  const userCount = conversation.filter(item => item.kind === 'message' && item.role === 'user').length
  const hasSubmission = Boolean(draft.trim() || attachments.length)
  const [autoTts, setAutoTts] = React.useState(false)
  const spokenCountRef = React.useRef(0)
  const speechRef = React.useRef<HTMLAudioElement | null>(null)
  const assistantMessages = conversation.filter((item): item is Extract<TimelineItem, { kind: 'message' }> => item.kind === 'message' && item.role === 'assistant')
  const chainedVoice = useChainedVoiceConversation({
    connected, visible, connectionKey, profile: profiles?.selected || null, sessionId, turnBusy, draft,
    attachmentCount: attachments.length, assistantMessages, onSubmit: sendMessage, onStatus: setChatStatus,
  })

  React.useEffect(() => {
    if (!chainedVoice.active) return
    spokenCountRef.current = assistantMessages.length
    speechRef.current?.pause()
    speechRef.current = null
  }, [chainedVoice.active, assistantMessages.length])

  React.useEffect(() => {
    let active = true
    const profile = profiles?.selected
    spokenCountRef.current = assistantMessages.length
    speechRef.current?.pause()
    speechRef.current = null
    setAutoTts(false)
    if (connected && profile) void agentSettings.config({ kind: 'profile', profile }).then(config => {
      const voiceConfig = config.voice
      if (active) setAutoTts(Boolean(voiceConfig && typeof voiceConfig === 'object' && !Array.isArray(voiceConfig) && (voiceConfig as Record<string, unknown>).auto_tts))
    }).catch(() => {})
    return () => { active = false; speechRef.current?.pause(); speechRef.current = null }
  }, [connected, profiles?.selected, sessionId, agentSettings])

  React.useEffect(() => {
    if (!autoTts || chainedVoice.active || turnBusy || !profiles?.selected || assistantMessages.length <= spokenCountRef.current) return
    let active = true
    spokenCountRef.current = assistantMessages.length
    const latest = assistantMessages.at(-1)
    if (!latest?.text.trim()) return
    void voice.speak({ kind: 'profile', profile: profiles.selected }, latest.text).then(result => {
      if (!active || !result.data_url) return
      speechRef.current?.pause()
      const audio = new Audio(result.data_url)
      speechRef.current = audio
      audio.onended = () => { if (speechRef.current === audio) speechRef.current = null }
      return audio.play()
    }).catch(error => { if (active) setChatStatus(language === 'zh-CN' ? `自动播报失败：${String(error)}` : `Automatic speech failed: ${String(error)}`) })
    return () => { active = false }
  }, [assistantMessages.length, autoTts, chainedVoice.active, turnBusy, profiles?.selected, sessionId, voice, language, setChatStatus])

  React.useLayoutEffect(() => {
    if (sessionId !== lastSessionRef.current || userCount !== lastUserCountRef.current) followMessagesRef.current = true
    lastSessionRef.current = sessionId
    lastUserCountRef.current = userCount
    const content = contentRef.current
    if (content && followMessagesRef.current) content.scrollTop = content.scrollHeight
  }, [conversation, assistant, serverRequest, sessionId, userCount])

  const empty = conversation.length === 0 && !assistant && !sessionId
  const servedProfiles = new Set(profiles?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]) || [])
  const panelLabel = panelOpen ? (language === 'zh-CN' ? '收起面板' : 'Collapse panel') : (language === 'zh-CN' ? '文件与终端' : 'Files & terminal')
  const panelToggle = remote ? null : <button type="button" className="chat-panel-toggle" aria-label={panelOpen ? (language === 'zh-CN' ? '收起右侧工作区' : 'Collapse side workspace') : (language === 'zh-CN' ? '打开文件与终端面板' : 'Open files and terminal panel')} aria-pressed={panelOpen} onClick={onTogglePanel}>{panelLabel}</button>
  return <section className={`chat-panel ${draggingFiles ? 'drop-active' : ''} ${empty ? 'chat-empty chat-design-new' : ''}`}>
      {!backend ? <div className="chat-gate"><span className="hero-mark">H</span><h2>{t("ui.ready.to.chat")}</h2><p>{t("ui.after.starting.the.native.runtime.and.configuring.the.model.you.can.create")}</p><button onClick={() => openView('runtime')}>{t("ui.start.the.runtime")}</button><small>{localizeAppMessage(language, backendStatus)}</small></div> : <>
      {empty && <div className="new-chat-heading"><h2>{language === 'zh-CN' ? '开始新会话' : 'Start a new chat'}</h2><p>{remote ? (language === 'zh-CN' ? '向远端 Hermess 描述任务。' : 'Describe a task to the remote Hermess.') : (language === 'zh-CN' ? '向 Hermess 描述任务，或添加文件一起处理。' : 'Describe a task to Hermess, or add files to work on together.')}</p></div>}
      {!empty && <div className="chat-workspace"><span>{t('ui.workspace.current')}: <strong title={remote ? '' : sessionId ? sessionWorkspacePath : workspacePath}>{remote ? (language === 'zh-CN' ? '远端默认目录' : 'Remote default directory') : (sessionId ? sessionWorkspacePath : workspacePath) || t('ui.workspace.default')}</strong></span>
        <div className="chat-workspace-actions">{!remote && <button type="button" onClick={onOpenWorkspaces}>{t('ui.workspace.change')}</button>}{panelToggle}</div></div>}
      <div ref={contentRef} className="chat-content" onScroll={event => {
        const content = event.currentTarget
        followMessagesRef.current = content.scrollHeight - content.scrollTop - content.clientHeight < 48
      }}>
      {!empty && <MessageList messages={conversation} assistant={assistant} turnBusy={turnBusy} language={language} t={t} />}
      {serverRequest && <GatewayRequestCard request={serverRequest} answers={clarifyAnswers} t={t}
        onAnswerChange={setClarifyAnswer}
        onSubmit={choice => void answerRequest(choice)} />}
      </div>
      <div className="composer-wrap"><div className="composer">
       <textarea ref={draftInputRef} value={draft} disabled={navigationBusy} onChange={event => { setDraft(event.target.value); setDraftCaret(event.target.selectionStart); setActiveChoice(0) }}
         onSelect={event => setDraftCaret(event.currentTarget.selectionStart)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter' && event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault()
            const input = event.currentTarget
            const start = input.selectionStart
            const end = input.selectionEnd
            const caret = start + 1
            setDraft(value => `${value.slice(0, start)}\n${value.slice(end)}`)
            setDraftCaret(caret)
            requestAnimationFrame(() => input.setSelectionRange(caret, caret))
          } else if (choices.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setActiveChoice(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length)
          } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault()
            if (event.repeat) return
            if (choices.length) chooseCommand(choices[activeChoice] || choices[0])
            else if (!turnBusy && !attachmentBusy && !reasoningBusy && (draft.trim() || attachments.length)) void sendMessage()
          } else if (choices.length && event.key === 'Escape') {
            setDraft(value => `${value} `)
          }
        }} placeholder={t("ui.what.do.you.want.to.do.today.enter.to.select.a.command.to.select.a.skill")} rows={3} />
      <CommandSuggestions visible={Boolean(trigger && sessionId)} choices={choices} activeChoice={activeChoice} catalog={commandCatalog} error={commandCatalogError} t={t} onChoose={chooseCommand} />
      <AttachmentQueue attachments={attachments} busy={attachmentBusy || turnBusy || navigationBusy} t={t} onRemove={index => void removeAttachment(index)} />
      <div className="composer-actions">
        {!remote && <button className="secondary-button" disabled={turnBusy || attachmentBusy || navigationBusy} onClick={() => void chooseAttachments()}>{t("ui.attach")}</button>}
        <VoiceRecorderButton profile={profiles?.selected || null} scopeKey={sessionId || 'new'} disabled={!backend || turnBusy || navigationBusy || chainedVoice.active} onTranscript={text => { setDraft(current => current ? `${current}\n${text}` : text); requestAnimationFrame(() => draftInputRef.current?.focus()) }} onStatus={setChatStatus} />
        {!sessionId && profiles && <label className="composer-profile-picker"><span className="sr-only">Profile</span><select aria-label="Profile" value={profiles.selected} disabled={profileBusy || navigationBusy} onChange={event => onSelectProfile(event.target.value)}>
          {profiles.profiles.map(profile => <option value={profile.name} key={profile.name} disabled={profile.name !== 'default' && !servedProfiles.has(profile.name)}>{profile.display_name || profile.name}</option>)}
        </select></label>}
        <span className="composer-spacer" />
        <ContextUsageIndicator usage={chatUsage} language={language} />
        <label className="reasoning-picker">
          <select aria-label={language === 'zh-CN' ? '思考强度' : 'Reasoning effort'} value={reasoningEffort} disabled={reasoningBusy || navigationBusy || !backend} onChange={event => void changeReasoning(event.target.value)}>
            <option value="" disabled>{!backend
              ? language === 'zh-CN' ? '思考 · 未连接' : 'Reasoning · Disconnected'
              : reasoningLoadFailed
                ? language === 'zh-CN' ? '思考 · 读取失败' : 'Reasoning · Unavailable'
                : language === 'zh-CN' ? '思考 · 读取中' : 'Reasoning · Loading'}</option>
            {['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option value={value} key={value}>{language === 'zh-CN' ? '思考' : 'Reasoning'} · {value}</option>)}
          </select>
        </label>
        <button ref={modelButtonRef} className="secondary-button composer-model-button" disabled={turnBusy || navigationBusy} aria-haspopup="dialog" aria-expanded={modelPickerOpen} onClick={() => modelPickerOpen ? setModelPickerOpen(false) : void openModelPicker()}>{activeModel?.model || savedModel?.model || t("ui.select.model")}</button>
        {turnBusy ? <button className="composer-submit" onClick={() => void interruptSession()}>{t("ui.stop")}</button>
          : canContinue && !hasSubmission
            ? <button className="composer-submit" disabled={navigationBusy || attachmentBusy || reasoningBusy} onClick={() => void sendMessage(t("ui.continue.stopped.task.prompt"))}>{t("ui.continue")}</button>
            : <button className="composer-submit" disabled={navigationBusy || attachmentBusy || reasoningBusy || !hasSubmission} onClick={() => void sendMessage()}>{t("ui.send")}</button>}
      </div>
      {modelPickerOpen && <ModelPicker pickerRef={modelPickerRef} position={pickerPosition} busy={pickerBusy} error={pickerError}
        confirmation={pickerConfirmation} providers={pickerProviders} provider={pickerProvider} models={pickerModels} modelInput={pickerModelInput}
        activeModel={activeModel || savedModel} turnBusy={turnBusy} t={t} onClose={() => setModelPickerOpen(false)}
        onProviderChange={setPickerProvider} onModelInputChange={setPickerModelInput} onPick={(provider, model, remember, confirm) => void pickModel(provider, model, remember, confirm)}
        onOpenSettings={() => { setModelPickerOpen(false); openView('model') }} />}
      </div>{empty && <div className="chat-workspace-controls">{remote ? <span>{language === 'zh-CN' ? '远端默认目录' : 'Remote default directory'}</span> : <button type="button" className="chat-workspace-below" onClick={onOpenWorkspaces} title={workspacePath || t('ui.workspace.default')}>▣ {language === 'zh-CN' ? '选择工作区' : 'Choose workspace'} <strong>{workspacePath ? workspacePath.split(/[\\/]/).filter(Boolean).at(-1) : t('ui.workspace.default')}</strong>⌄</button>}{panelToggle}</div>}
      <small className="composer-hint">{remote ? (language === 'zh-CN' ? '远端会话暂不支持本机文件附件' : 'Local file attachments are unavailable for remote sessions') : draggingFiles ? t("ui.release.to.stage.file") : t("ui.files.can.be.dragged.in.individual.attachments.cannot.exceed.20.mib")} · {choices.length
        ? language === 'zh-CN' ? 'Enter 选择候选，Ctrl+Enter 换行' : 'Enter to select, Ctrl+Enter for a new line'
        : language === 'zh-CN' ? 'Enter 发送，Ctrl+Enter 换行' : 'Enter to send, Ctrl+Enter for a new line'}</small><p role="status" className="chat-status">{localizeAppMessage(language, chatStatus)}</p></div>
      </>}
  </section>
}
