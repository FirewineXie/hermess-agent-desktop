import React from 'react'
import type { BackendInfo, GatewayEvent, ReplayResult, GatewayRequest, ApprovalChoice, SessionRow } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { commandSupported, commandChoices, composerTrigger, type PendingAttachment, type CommandCatalog, type ComposerChoice, type ChatUsage } from './model'
import type { ModelPick } from '../models/model'
import { appendMessage, appendReasoning, finishReasoning, finishTurn, historyTimeline, updateTool, type TimelineItem } from './timeline'

type Options = {
  backend: BackendInfo | null
  activeModel: ModelPick | null
  language: 'zh-CN' | 'en-US'
  storagePath: string
  t: (key: string, ...values: unknown[]) => string
  openView: (view: 'chat' | 'model') => void
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActiveModel: React.Dispatch<React.SetStateAction<ModelPick | null>>
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setBackend: React.Dispatch<React.SetStateAction<BackendInfo | null>>
  setBackendStatus: React.Dispatch<React.SetStateAction<string>>
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
}

export function useChatController({ backend, activeModel, language, storagePath, t, openView, setSidebarOpen, setActiveModel, setModelPickerOpen, setBackend, setBackendStatus, setBusy }: Options) {
  const { events, nativeFiles, chat, runtime, diagnostics } = useDesktop()
  const [sessionId, setSessionId] = React.useState('')
  const [reasoningEffort, setReasoningEffort] = React.useState('')
  const [reasoningBusy, setReasoningBusy] = React.useState(false)
  const reasoningChangeInFlightRef = React.useRef(false)
  const [chatUsage, setChatUsage] = React.useState<ChatUsage | null>(null)
  const sessionRef = React.useRef('')
  const storedSessionRef = React.useRef('')
  const [draft, setDraft] = React.useState('')
  const [commandCatalog, setCommandCatalog] = React.useState<CommandCatalog | null>(null)
  const [commandCatalogError, setCommandCatalogError] = React.useState('')
  const [activeChoice, setActiveChoice] = React.useState(0)
  const [draftCaret, setDraftCaret] = React.useState(0)
  const commandCatalogPromiseRef = React.useRef<Promise<CommandCatalog> | null>(null)
  const draftInputRef = React.useRef<HTMLTextAreaElement>(null)
  const [conversation, setConversation] = React.useState<TimelineItem[]>([])
  const [assistant, setAssistant] = React.useState('')
  const assistantRef = React.useRef('')
  const [chatStatus, setChatStatus] = React.useState('')
  const [turnBusy, setTurnBusy] = React.useState(false)
  const turnStartedAtRef = React.useRef<number | null>(null)
  const [serverRequests, setServerRequests] = React.useState<GatewayRequest[]>([])
  const serverRequest = serverRequests[0] || null
  const [clarifyDraft, setClarifyDraft] = React.useState<{ requestId: string; answers: Record<string, string> }>({ requestId: '', answers: {} })
  const clarifyAnswers = clarifyDraft.requestId === serverRequest?.id ? clarifyDraft.answers : {}
  function setClarifyAnswer(qid: string, value: string) {
    if (!serverRequest || serverRequest.method !== 'clarify') return
    setClarifyDraft(current => ({
      requestId: serverRequest.id,
      answers: { ...(current.requestId === serverRequest.id ? current.answers : {}), [qid]: value },
    }))
  }
  const [sessions, setSessions] = React.useState<SessionRow[]>([])
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([])
  const [attachmentBusy, setAttachmentBusy] = React.useState(false)
  const [draggingFiles, setDraggingFiles] = React.useState(false)
  const lastSeqRef = React.useRef<Record<string, number>>({})
  const epochRef = React.useRef<Record<string, string>>({})
  const recoveringRef = React.useRef(false)
  const bufferedEventsRef = React.useRef<GatewayEvent[]>([])
  const bufferedRequestsRef = React.useRef<GatewayRequest[]>([])
  const eventProcessorRef = React.useRef<(data: GatewayEvent) => void>(() => {})

  eventProcessorRef.current = data => {
    const id = data.session_id
    if (!id || id !== sessionRef.current) return
    if (typeof data.seq === 'number') {
      if (data.seq <= (lastSeqRef.current[id] || 0)) return
      lastSeqRef.current[id] = data.seq
    }
    if ((data.kind === 'reasoning.delta' || data.kind === 'reasoning.available') && typeof data.payload?.text === 'string') {
      setConversation(rows => appendReasoning(rows, data.payload.text as string, data.kind === 'reasoning.available'))
    } else if (data.kind === 'message.delta' && typeof data.payload?.text === 'string') {
      setConversation(finishReasoning)
      assistantRef.current += data.payload.text
      setAssistant(assistantRef.current)
    } else if (data.kind === 'message.complete') {
      const usage = data.payload?.usage
      if (usage && typeof usage === 'object' && ('context_used' in usage || 'context_max' in usage)) {
        setChatUsage(usage as ChatUsage)
      } else {
        void chat.usage(id).then(result => {
          if (sessionRef.current === id) setChatUsage(result)
        }).catch(() => {})
      }
      const text = typeof data.payload?.text === 'string' ? data.payload.text : ''
      const startedAt = turnStartedAtRef.current
      const endedAt = Date.now()
      turnStartedAtRef.current = null
      setConversation(rows => {
        const closed = finishReasoning(rows)
        const finished = startedAt == null ? closed : finishTurn(closed, Math.max(0, (endedAt - startedAt) / 1000), 'completed')
        return appendMessage(finished, 'assistant', text || assistantRef.current)
      })
      assistantRef.current = ''
      setAssistant('')
      setTurnBusy(false)
      setChatStatus(data.payload?.status === 'error' ? t("ui.response.failed") : t("ui.response.complete"))
      void loadSessions(true)
    } else if (data.kind === 'error') {
      setChatStatus(t("ui.backend.error"))
      finishCurrentTurn('failed')
      setTurnBusy(false)
    } else if (data.kind === 'tool.start' || data.kind === 'tool.complete') {
      setConversation(rows => updateTool(finishReasoning(rows), data.kind as 'tool.start' | 'tool.complete', data.payload || {}))
      setChatStatus(t("ui.arg.arg", t(data.kind === 'tool.start' ? 'ui.calling' : 'ui.tool.finished'), String(data.payload?.name || t("ui.tool"))))
    } else if (data.kind === 'request.cancel') {
      setServerRequests(current => current.filter(request => request.id !== data.payload?.id))
      setClarifyDraft(current => current.requestId === data.payload?.id ? { requestId: '', answers: {} } : current)
    }
  }

  function finishCurrentTurn(state: 'failed' | 'interrupted') {
    setConversation(finishReasoning)
    const startedAt = turnStartedAtRef.current
    if (startedAt == null) return
    turnStartedAtRef.current = null
    const elapsed = Math.max(0, (Date.now() - startedAt) / 1000)
    setConversation(rows => finishTurn(rows, elapsed, state))
  }

  React.useEffect(() => {
    let active = true
    let unlistenEvent: (() => void) | undefined
    let unlistenDisconnect: (() => void) | undefined
    let unlistenRequest: (() => void) | undefined
    void events.onGatewayEvent(data => {
      if (!active) return
      if (recoveringRef.current) bufferedEventsRef.current.push(data)
      else eventProcessorRef.current(data)
    }).then(fn => { if (active) unlistenEvent = fn; else fn() })
    void events.onGatewayRequest(request => {
      if (active && recoveringRef.current) bufferedRequestsRef.current.push(request)
      else if (active && request.params.session_id === sessionRef.current) {
        setServerRequests(current => current.some(item => item.id === request.id) ? current : [...current, request])
      }
    }).then(fn => { if (active) unlistenRequest = fn; else fn() })
    void events.onDisconnect(() => {
      if (active) { setChatStatus(t("ui.connection.interrupted.please.check.the.connection.before.resuming.the.sess")); setConversation(finishReasoning); setTurnBusy(false); setServerRequests([]); setClarifyDraft({ requestId: '', answers: {} }) }
    }).then(fn => { if (active) unlistenDisconnect = fn; else fn() })
    return () => { active = false; unlistenEvent?.(); unlistenRequest?.(); unlistenDisconnect?.() }
  }, [])

  async function answerRequest(choice?: ApprovalChoice) {
    if (!serverRequest) return
    const request = serverRequest
    try {
      await chat.answerRequest({
        requestId: request.id,
        method: request.method,
        choice,
        answers: request.method === 'clarify' ? clarifyAnswers : undefined,
      })
      setServerRequests(current => current.filter(item => item.id !== request.id))
      setClarifyDraft(current => current.requestId === request.id ? { requestId: '', answers: {} } : current)
      setChatStatus(request.method === 'approval' ? t("ui.approval.decision.submitted") : t("ui.clarification.answer.submitted"))
    } catch (cause) { setChatStatus(t("ui.failed.to.process.request.arg", describeError(cause, language))) }
  }

  async function ensureChatSession() {
    if (sessionRef.current) return sessionRef.current
    const created = await chat.createSession()
    const id = created.session_id
    sessionRef.current = id
    epochRef.current[id] = backend?.replay_epoch || ''
    lastSeqRef.current[id] = 0
    storedSessionRef.current = created.stored_session_id
    setSessionId(id)
    setActiveModel(created.info?.provider && created.info.model ? { provider: created.info.provider, model: created.info.model } : null)
    return id
  }

  React.useEffect(() => {
    if (!backend || !sessionId) {
      setReasoningEffort('')
      setChatUsage(null)
      return
    }
    let active = true
    void Promise.allSettled([
      chat.reasoning(sessionId),
      chat.usage(sessionId),
    ]).then(([reasoning, usage]) => {
      if (!active || sessionRef.current !== sessionId) return
      if (reasoning.status === 'fulfilled' && !reasoningChangeInFlightRef.current) setReasoningEffort(reasoning.value.value || '')
      if (usage.status === 'fulfilled') setChatUsage(usage.value)
    })
    return () => { active = false }
  }, [backend, sessionId, activeModel?.provider, activeModel?.model])

  async function changeReasoning(value: string) {
    if (reasoningChangeInFlightRef.current || !backend || !value) return
    reasoningChangeInFlightRef.current = true
    setReasoningBusy(true)
    try {
      const id = await ensureChatSession()
      const saved = await chat.setReasoning(id, value)
      if (saved.value !== value) throw new Error(language === 'zh-CN' ? '后端未确认思考强度修改' : 'The backend did not confirm the reasoning change')
      const current = await chat.reasoning(id)
      if (current.value !== value) throw new Error(language === 'zh-CN' ? '思考强度回读与所选档位不一致' : 'The reasoning value did not match after reading it back')
      if (sessionRef.current === id) {
        setReasoningEffort(value)
        setChatStatus(language === 'zh-CN' ? '当前会话思考强度已更新' : 'Reasoning effort updated for this session')
      }
    } catch (cause) { setChatStatus(describeError(cause, language)) }
    finally { reasoningChangeInFlightRef.current = false; setReasoningBusy(false) }
  }

  function loadCommandCatalog(): Promise<CommandCatalog> {
    if (commandCatalog) return Promise.resolve(commandCatalog)
    if (!commandCatalogPromiseRef.current) {
      commandCatalogPromiseRef.current = ensureChatSession()
        .then(id => chat.commands(id))
        .then(catalog => {
          setCommandCatalog(catalog)
          setCommandCatalogError(catalog.warning || '')
          return catalog
        })
        .catch(cause => {
          commandCatalogPromiseRef.current = null
          setCommandCatalogError(t("ui.command.directory.read.failed.arg", describeError(cause, language)))
          throw cause
        })
    }
    return commandCatalogPromiseRef.current
  }

  React.useEffect(() => {
    if (backend && composerTrigger(draft, draftCaret) && !commandCatalog) {
      void loadCommandCatalog().catch(() => {})
    }
  }, [backend, draft, draftCaret, commandCatalog])

  const trigger = composerTrigger(draft, draftCaret)
  const choices = commandCatalog && trigger ? commandChoices(commandCatalog, trigger, language) : []
  function chooseCommand(choice: ComposerChoice) {
    if (!trigger) return
    if (!choice.available) { setChatStatus(`${choice.name}：${choice.availability}`); return }
    const replacement = `${choice.name} `
    const caret = trigger.start + replacement.length
    setDraft(`${draft.slice(0, trigger.start)}${replacement}${draft.slice(trigger.end)}`)
    setDraftCaret(caret)
    setActiveChoice(0)
    requestAnimationFrame(() => {
      draftInputRef.current?.focus()
      draftInputRef.current?.setSelectionRange(caret, caret)
    })
  }

  async function addAttachments(paths: string[]) {
    if (!backend || turnBusy || attachmentBusy) return
    if (paths.length + attachments.length > 10) { setChatStatus(t("ui.up.to.10.attachments.can.be.temporarily.saved.per.round")); return }
    setAttachmentBusy(true)
    try {
      const id = await ensureChatSession()
      const existing = new Set(attachments.map(item => item.source_path))
      for (const path of paths) {
        if (existing.has(path)) continue
        const attached = await chat.attachFile(id, path)
        setAttachments(current => [...current, attached])
        existing.add(attached.source_path)
      }
      setChatStatus(t("ui.arg.attachments.staged.they.will.be.included.with.the.next.message", paths.length))
    } catch (cause) { setChatStatus(t("ui.failed.to.temporarily.save.attachment.arg", describeError(cause, language))) }
    finally { setAttachmentBusy(false) }
  }

  async function chooseAttachments() {
    try {
      const selected = await nativeFiles.choose({ directory: false, multiple: true, title: t("ui.select.attachments.no.more.than.20.mib.each") })
      if (selected) await addAttachments(Array.isArray(selected) ? selected : [selected])
    } catch (cause) { setChatStatus(t("ui.failed.to.select.attachment.arg", describeError(cause, language))) }
  }

  React.useEffect(() => {
    if (!backend) return
    let active = true
    let unlisten: (() => void) | undefined
    void nativeFiles.onDrop(event => {
      if (!active) return
      if (event.type === 'enter') setDraggingFiles(true)
      if (event.type === 'leave') setDraggingFiles(false)
      if (event.type === 'drop') {
        setDraggingFiles(false)
        void addAttachments(event.paths)
      }
    }).then(fn => { if (active) unlisten = fn; else fn() })
      .catch(cause => setChatStatus(t("ui.file.drag.in.monitoring.failed.arg", describeError(cause, language))))
    return () => { active = false; unlisten?.() }
  }, [backend, turnBusy, attachmentBusy])

  async function removeAttachment(index: number) {
    const attachment = attachments[index]
    if (!attachment || attachmentBusy) return
    setAttachmentBusy(true)
    try {
      if (attachment.kind === 'image' && attachment.path) {
        await chat.detachImage(sessionRef.current, attachment.path)
      }
      setAttachments(current => current.filter((_, position) => position !== index))
    } catch (cause) { setChatStatus(t("ui.failed.to.remove.attachment.arg", describeError(cause, language))) }
    finally { setAttachmentBusy(false) }
  }

  async function clearPendingImages() {
    for (const attachment of attachments) {
      if (attachment.kind === 'image' && attachment.path) {
        await chat.detachImage(sessionRef.current, attachment.path)
      }
    }
    setAttachments([])
  }

  async function sendMessage() {
    const refs = attachments.filter(item => item.kind === 'file' && item.ref_text).map(item => item.ref_text)
    const typed = draft.trim()
    let text = [typed, ...refs].filter(Boolean).join('\n') || (attachments.length ? t("ui.please.see.attachment") : '')
    if (!text || turnBusy || attachmentBusy || reasoningChangeInFlightRef.current) return
    const slash = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(typed)
    const mentions = Array.from(typed.matchAll(/(^|\s)@([^\s]+)/g))
    let catalog: CommandCatalog | null = null
    if (slash || mentions.length) {
      try { catalog = await loadCommandCatalog() }
      catch { if (slash) return }
    }
    const skillMention = mentions.find(match => catalog && Object.hasOwn(catalog.skills, `/${match[2]}`))
    const commandName = slash ? `/${slash[1]}` : skillMention ? `/${skillMention[2]}` : ''
    const isSkill = !!(catalog && Object.hasOwn(catalog.skills, commandName))
    const isCommand = !!(slash || skillMention)
    const commandArg = slash ? slash[2] || '' : skillMention
      ? `${typed.slice(0, skillMention.index)}${typed.slice(skillMention.index! + skillMention[0].length)}`.trim()
      : ''
    // @file:, @folder: and ordinary @mentions remain regular prompt text.
    if (isCommand && (!catalog?.pairs.some(([name]) => name === commandName)
      || !commandSupported(catalog, commandName))) {
      setChatStatus(t("ui.this.command.does.not.exist.for.the.current.session.arg", commandName))
      return
    }
    if (isCommand && attachments.length && !isSkill) { setChatStatus(t("ui.please.remove.the.attachment.first.when.executing.the.command")); return }
    if (isCommand && commandName === '/new' && commandArg) {
      setChatStatus(t("ui.the.desktop.new.command.does.not.accept.a.title.yet.create.a.session.then.u"))
      return
    }
    if (isCommand && commandName === '/sessions' && commandArg) {
      setChatStatus(t("ui.the.desktop.sessions.command.does.not.accept.arguments"))
      return
    }
    if (isCommand && commandName === '/model' && commandArg) {
      setChatStatus(t("ui.choose.a.model.in.model.settings.arguments.after.model.do.not.change.the.cu"))
      return
    }
    assistantRef.current = ''
    setAssistant('')
    setTurnBusy(true)
    setChatStatus(t("ui.submitting"))
    try {
      if (commandName === '/new' && isCommand) {
        await newChat()
        setTurnBusy(false)
        return
      }
      if (commandName === '/sessions' && isCommand) {
        await loadSessions(true)
        openView('chat')
        setSidebarOpen(true)
        setDraft('')
        setTurnBusy(false)
        return
      }
      if (commandName === '/model' && isCommand) {
        openView('model')
        setDraft('')
        setTurnBusy(false)
        return
      }
      const id = await ensureChatSession()
      if (isCommand) {
        const result = isSkill
          ? await chat.dispatchSkill(id, commandName.slice(1), commandArg)
          : await chat.executeCommand(id, `${commandName}${commandArg ? ` ${commandArg}` : ''}`)
        if (result.type === 'skill' || result.type === 'send') {
          if (!result.message) throw new Error(t("ui.the.command.did.not.return.a.message.to.send"))
          text = [result.message, ...refs].filter(Boolean).join('\n')
        } else if (result.type === 'prefill') {
          setDraft(result.message || '')
          setChatStatus(result.notice || t("ui.the.command.has.been.filled.in.the.input.box"))
          setTurnBusy(false)
          return
        } else if (result.type === 'exec' || result.type === 'plugin' || !result.type) {
          setConversation(rows => appendMessage(appendMessage(rows, 'user', typed), 'assistant', result.output || result.notice || t("ui.command.execution.completed")))
          setDraft('')
          setChatStatus(t("ui.command.execution.completed"))
          setTurnBusy(false)
          return
        } else {
          throw new Error(t("ui.this.command.return.type.is.not.supported.yet.arg", result.type))
        }
      }
      const startedAt = Date.now()
      turnStartedAtRef.current = startedAt
      setConversation(rows => appendMessage(rows, 'user', typed || text, startedAt))
      setDraft('')
      const result = await chat.submitPrompt(id, text)
      setAttachments([])
      setChatStatus(previous => previous === t("ui.response.complete") ? previous : t("ui.received.arg", result.status || t('ui.waiting.for.events')))
    } catch (cause) {
      setChatStatus(t("ui.submission.failed.arg.please.check.the.history.first.to.avoid.repeated.subm", describeError(cause, language)))
      finishCurrentTurn('failed')
      setTurnBusy(false)
    }
  }

  async function loadSessions(quiet = false) {
    try {
      const result = await chat.listSessions()
      setSessions(result.sessions)
      if (!quiet) setChatStatus(t("ui.arg.historical.conversations.found", result.sessions.length))
    } catch (cause) { setChatStatus(t("ui.failed.to.read.history.arg", describeError(cause, language))) }
  }

  async function newChat() {
    if (turnBusy || attachmentBusy) return
    try { await clearPendingImages() }
    catch (cause) { setChatStatus(t("ui.failed.to.remove.image.before.creating.new.session.arg", describeError(cause, language))); return }
    sessionRef.current = ''
    turnStartedAtRef.current = null
    storedSessionRef.current = ''
    setSessionId('')
    setActiveModel(null)
    setModelPickerOpen(false)
    setConversation([])
    assistantRef.current = ''
    setAssistant('')
    setServerRequests([])
    setClarifyDraft({ requestId: '', answers: {} })
    setDraft('')
    setCommandCatalog(null)
    commandCatalogPromiseRef.current = null
    setChatStatus(t("ui.new.session.ready"))
  }

  async function resumeSession(id: string) {
    if (turnBusy || attachmentBusy) return
    setChatStatus(t("ui.resuming.session"))
    try {
      await clearPendingImages()
      const result = await chat.resumeSession(id)
      turnStartedAtRef.current = null
      sessionRef.current = result.session_id
      storedSessionRef.current = result.stored_session_id || result.session_key || id
      epochRef.current[result.session_id] = backend?.replay_epoch || ''
      lastSeqRef.current[result.session_id] = result.last_sequence || 0
      setServerRequests((result.open_requests || []).filter(request => request.method === 'approval' || request.method === 'clarify'))
      setClarifyDraft({ requestId: '', answers: {} })
      setSessionId(result.session_id)
      setActiveModel(result.info?.provider && result.info.model ? { provider: result.info.provider, model: result.info.model } : null)
      setModelPickerOpen(false)
      setDraft('')
      setCommandCatalog(null)
      commandCatalogPromiseRef.current = null
      setConversation(historyTimeline(result.messages))
      assistantRef.current = result.inflight?.assistant || ''
      setAssistant(assistantRef.current)
      setTurnBusy(Boolean(result.running))
      setChatStatus(result.running ? t("ui.restored.task.still.running") : t("ui.session.resumed"))
    } catch (cause) { setChatStatus(t("ui.restore.failed.arg", describeError(cause, language))) }
  }

  async function interruptSession() {
    if (!sessionRef.current) return
    try {
      const result = await chat.interruptSession(sessionRef.current)
      setChatStatus(result.status === 'interrupted' ? t("ui.requested.to.stop.current.task") : t("ui.there.are.currently.no.tasks.running"))
      if (result.status === 'interrupted') finishCurrentTurn('interrupted')
      else setConversation(finishReasoning)
      setTurnBusy(false)
    } catch (cause) { setChatStatus(t("ui.failed.to.stop.task.arg", describeError(cause, language))) }
  }

  async function reconnectBackend() {
    if (recoveringRef.current) return
    recoveringRef.current = true
    bufferedEventsRef.current = []
    bufferedRequestsRef.current = []
    const previousId = sessionRef.current
    const previousEpoch = epochRef.current[previousId]
    const previousSeq = lastSeqRef.current[previousId] || 0
    setBusy(true)
    setBackendStatus(t("ui.reconnecting"))
    try {
      const info = await runtime.reconnect()
      setBackend(info)
      setBackendStatus(previousEpoch && info.replay_epoch !== previousEpoch
        ? t("ui.reconnected.pictures.to.be.sent.need.to.be.added.again") : t("ui.reconnected"))
      if (previousEpoch && info.replay_epoch !== previousEpoch) {
        setAttachments(current => current.filter(item => item.kind === 'file'))
      }
      if (storedSessionRef.current) {
        const snapshot = await chat.resumeSession(storedSessionRef.current)
        const id = snapshot.session_id
        const sameStream = id === previousId && Boolean(previousEpoch) && info.replay_epoch === previousEpoch
        let replay: ReplayResult | undefined
        if (sameStream) {
          replay = await chat.replayEvents(id, previousSeq, previousEpoch)
        }
        const useSnapshot = !sameStream || !replay || replay.truncated || replay.epoch !== previousEpoch
        sessionRef.current = id
        storedSessionRef.current = snapshot.stored_session_id || snapshot.session_key || storedSessionRef.current
        setSessionId(id)
        setActiveModel(snapshot.info?.provider && snapshot.info.model ? { provider: snapshot.info.provider, model: snapshot.info.model } : null)
        setClarifyDraft({ requestId: '', answers: {} })
        setServerRequests((replay?.open_requests || snapshot.open_requests || []).filter(request => request.method === 'approval' || request.method === 'clarify'))
        setTurnBusy(Boolean(snapshot.running))
        if (useSnapshot) {
          turnStartedAtRef.current = null
          setConversation(historyTimeline(snapshot.messages))
          assistantRef.current = snapshot.inflight?.assistant || ''
          setAssistant(assistantRef.current)
          epochRef.current[id] = info.replay_epoch
          lastSeqRef.current[id] = snapshot.last_sequence || 0
        } else if (replay) {
          const ordered = replay.events.map(event => ({
            kind: event.type, session_id: event.session_id, seq: event.seq,
            payload: event.payload || {},
          })).sort((a, b) => (a.seq || 0) - (b.seq || 0))
          for (const event of ordered) eventProcessorRef.current(event)
        }
        const buffered = bufferedEventsRef.current.splice(0)
          .sort((a, b) => (a.seq || 0) - (b.seq || 0))
        for (const event of buffered) eventProcessorRef.current(event)
        for (const request of bufferedRequestsRef.current.splice(0)) {
          if (request.params.session_id === id) {
            setServerRequests(current => current.some(item => item.id === request.id) ? current : [...current, request])
          }
        }
        if (useSnapshot) setChatStatus(replay?.truncated ? t("ui.event.window.truncated.restored.from.session.snapshot") : t("ui.restored.from.session.snapshot"))
        else if (replay?.events.length === 0) setChatStatus(snapshot.running ? t("ui.restored.task.still.running") : t("ui.session.resumed"))
      }
    } catch (cause) {
      void diagnostics.recordEvent(storagePath, 'reconnect_failed').catch(() => {})
      setBackendStatus(t("ui.reconnection.failed.arg", describeError(cause, language)))
    }
    finally {
      recoveringRef.current = false
      for (const event of bufferedEventsRef.current.splice(0)) eventProcessorRef.current(event)
      bufferedRequestsRef.current = []
      setBusy(false)
    }
  }


  function resetChat() {
    sessionRef.current = ''
    turnStartedAtRef.current = null
    storedSessionRef.current = ''
    setSessionId('')
    setConversation([])
    assistantRef.current = ''
    setAssistant('')
    setServerRequests([])
    setClarifyDraft({ requestId: '', answers: {} })
    setSessions([])
    setAttachments([])
    setCommandCatalog(null)
    commandCatalogPromiseRef.current = null
    setChatUsage(null)
    setTurnBusy(false)
  }

  return {
    sessionId, reasoningEffort, reasoningBusy, chatUsage, sessionRef, storedSessionRef,
    draft, setDraft, commandCatalog, commandCatalogError, activeChoice, setActiveChoice,
    draftCaret, setDraftCaret, draftInputRef, conversation, assistant, chatStatus, setChatStatus,
    turnBusy, serverRequest, clarifyAnswers, setClarifyAnswer, sessions, attachments,
    attachmentBusy, draggingFiles, trigger, choices, answerRequest, ensureChatSession,
    changeReasoning, chooseCommand, chooseAttachments, removeAttachment, sendMessage,
    loadSessions, newChat, resumeSession, interruptSession, reconnectBackend, resetChat,
  }
}
