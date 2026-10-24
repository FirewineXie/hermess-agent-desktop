import React from 'react'
import type { ModelProvider } from '@hermess/contracts'
import type { ModelPick, SavedModel } from '../models/model'
import { localizeAppMessage } from '../../i18n'
import type { useChatController } from './useChatController'
import GatewayRequestCard from './components/GatewayRequestCard'
import MessageList from './components/MessageList'
import AttachmentQueue from './components/AttachmentQueue'
import CommandSuggestions from './components/CommandSuggestions'
import ContextUsageIndicator from './components/ContextUsageIndicator'
import ModelPicker from './components/ModelPicker'

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
  backendStatus: string
  language: 'zh-CN' | 'en-US'
  t: (key: string, ...values: unknown[]) => string
  controller: ReturnType<typeof useChatController>
  picker: Picker
  onOpenRuntime: () => void
  onOpenModelSettings: () => void
}

export default function ChatView({ connected, backendStatus, language, t, controller, picker, onOpenRuntime, onOpenModelSettings }: Props) {
  const backend = connected
  const openView = (view: 'runtime' | 'model') => view === 'runtime' ? onOpenRuntime() : onOpenModelSettings()
  const {
    draft, setDraft, commandCatalog, commandCatalogError, activeChoice, setActiveChoice,
    setDraftCaret, draftInputRef, conversation, assistant, chatStatus, turnBusy,
    serverRequest, clarifyAnswers, setClarifyAnswer, attachments, attachmentBusy,
    draggingFiles, trigger, choices, answerRequest, changeReasoning, chooseCommand,
    chooseAttachments, removeAttachment, sendMessage, interruptSession, reasoningEffort,
    reasoningBusy, chatUsage,
  } = controller
  const {
    modelButtonRef, modelPickerRef, pickerPosition, modelPickerOpen, setModelPickerOpen,
    activeModel, savedModel, pickerBusy, pickerError, pickerConfirmation, pickerProviders,
    pickerProvider, setPickerProvider, pickerModels, pickerModelInput, setPickerModelInput,
    openModelPicker, pickModel,
  } = picker
  return <section className={`chat-panel ${draggingFiles ? 'drop-active' : ''} ${conversation.length === 0 && !assistant ? 'chat-empty' : ''}`}>
      {!backend ? <div className="chat-gate"><span className="hero-mark">H</span><h2>{t("ui.ready.to.chat")}</h2><p>{t("ui.after.starting.the.native.runtime.and.configuring.the.model.you.can.create")}</p><button onClick={() => openView('runtime')}>{t("ui.start.the.runtime")}</button><small>{localizeAppMessage(language, backendStatus)}</small></div> : <>
      <div className="chat-content">
      <MessageList messages={conversation} assistant={assistant} turnBusy={turnBusy} language={language} t={t} />
      {serverRequest && <GatewayRequestCard request={serverRequest} answers={clarifyAnswers} t={t}
        onAnswerChange={setClarifyAnswer}
        onSubmit={choice => void answerRequest(choice)} />}
      </div>
      <div className="composer-wrap"><div className="composer">
       <textarea ref={draftInputRef} value={draft} onChange={event => { setDraft(event.target.value); setDraftCaret(event.target.selectionStart); setActiveChoice(0) }}
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
            else if (!turnBusy && !attachmentBusy && (draft.trim() || attachments.length)) void sendMessage()
          } else if (choices.length && event.key === 'Escape') {
            setDraft(value => `${value} `)
          }
        }} placeholder={t("ui.what.do.you.want.to.do.today.enter.to.select.a.command.to.select.a.skill")} rows={3} />
      <CommandSuggestions visible={Boolean(trigger)} choices={choices} activeChoice={activeChoice} catalog={commandCatalog} error={commandCatalogError} t={t} onChoose={chooseCommand} />
      <AttachmentQueue attachments={attachments} busy={attachmentBusy || turnBusy} t={t} onRemove={index => void removeAttachment(index)} />
      <div className="composer-actions">
        <button className="secondary-button" disabled={turnBusy || attachmentBusy} onClick={() => void chooseAttachments()}>{t("ui.attach")}</button>
        <span className="composer-spacer" />
        <ContextUsageIndicator usage={chatUsage} language={language} />
        <label className="reasoning-picker">
          <select aria-label={language === 'zh-CN' ? '思考强度' : 'Reasoning effort'} value={reasoningEffort} disabled={reasoningBusy || !backend} onChange={event => void changeReasoning(event.target.value)}>
            <option value="" disabled>{language === 'zh-CN' ? '思考 · 选择档位' : 'Reasoning · Choose level'}</option>
            {['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option value={value} key={value}>{language === 'zh-CN' ? '思考' : 'Reasoning'} · {value}</option>)}
          </select>
        </label>
        <button ref={modelButtonRef} className="secondary-button" disabled={turnBusy} aria-haspopup="dialog" aria-expanded={modelPickerOpen} onClick={() => modelPickerOpen ? setModelPickerOpen(false) : void openModelPicker()}>{activeModel?.model || savedModel?.model || t("ui.select.model")}</button>
        {turnBusy ? <button onClick={() => void interruptSession()}>{t("ui.stop")}</button> : <button disabled={attachmentBusy || reasoningBusy || (!draft.trim() && attachments.length === 0)} onClick={() => void sendMessage()}>{t("ui.send")}</button>}
      </div>
      {modelPickerOpen && <ModelPicker pickerRef={modelPickerRef} position={pickerPosition} busy={pickerBusy} error={pickerError}
        confirmation={pickerConfirmation} providers={pickerProviders} provider={pickerProvider} models={pickerModels} modelInput={pickerModelInput}
        activeModel={activeModel} turnBusy={turnBusy} t={t} onRefresh={() => void openModelPicker(true)} onClose={() => setModelPickerOpen(false)}
        onProviderChange={setPickerProvider} onModelInputChange={setPickerModelInput} onPick={(provider, model, remember, confirm) => void pickModel(provider, model, remember, confirm)}
        onOpenSettings={() => { setModelPickerOpen(false); openView('model') }} />}
      </div><small className="composer-hint">{draggingFiles ? t("ui.release.to.stage.file") : t("ui.files.can.be.dragged.in.individual.attachments.cannot.exceed.20.mib")} · {choices.length
        ? language === 'zh-CN' ? 'Enter 选择候选，Ctrl+Enter 换行' : 'Enter to select, Ctrl+Enter for a new line'
        : language === 'zh-CN' ? 'Enter 发送，Ctrl+Enter 换行' : 'Enter to send, Ctrl+Enter for a new line'}</small><p role="status" className="chat-status">{localizeAppMessage(language, chatStatus)}</p></div>
      </>}
  </section>
}
