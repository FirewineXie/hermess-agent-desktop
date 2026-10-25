import React from 'react'
import type { BackendInfo, GatewayEvent, ReplayResult, ResumeResult, GatewayRequest, ApprovalChoice, SessionRow } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { commandSupported, commandChoices, composerTrigger, type PendingAttachment, type CommandCatalog, type ComposerChoice, type ChatUsage } from './model'
import type { ModelPick } from '../models/model'
import { appendMessage, appendReasoning, finishReasoning, finishTurn, historyTimeline, updateTool, type TimelineItem } from './timeline'
import { mergeRecoveredRequests } from './requestRecovery'

type Options = {
  backend: BackendInfo | null
  chatVisible: boolean
  activeModel: ModelPick | null
  language: 'zh-CN' | 'en-US'
  storagePath: string
  workspacePath: string
  t: (key: string, ...values: unknown[]) => string
  openView: (view: 'chat' | 'model') => void
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActiveModel: React.Dispatch<React.SetStateAction<ModelPick | null>>
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setBackend: React.Dispatch<React.SetStateAction<BackendInfo | null>>
  setBackendStatus: React.Dispatch<React.SetStateAction<string>>
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
}

function selectedWorkspacePath(info?: ResumeResult['info']): string {
  return info?.launch_request?.cwd_explicit === true ? info.cwd || info.launch_request.cwd || '' : ''
}

export function useChatController({ backend, chatVisible, activeModel, language, storagePath, workspacePath, t, openView, setSidebarOpen, setActiveModel, setModelPickerOpen, setBackend, setBackendStatus, setBusy }: Options) {
  const { events, nativeFiles, chat, runtime, diagnostics } = useDesktop()
  const [sessionId, setSessionId] = React.useState('')
  const [sessionWorkspacePath, setSessionWorkspacePath] = React.useState('')
  const [sessionCurrentDirectory, setSessionCurrentDirectory] = React.useState('')
  const [reasoningEffort, setReasoningEffort] = React.useState('')
  const [reasoningLoadFailed, setReasoningLoadFailed] = React.useState(false)
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
  const [canContinue, setCanContinue] = React.useState(false)
  const [navigationBusy, setNavigationBusy] = React.useState(false)
  const [sessionCreating, setSessionCreating] = React.useState(false)
  const navigationBusyRef = React.useRef(false)
  const submittingRef = React.useRef(false)
  const promptDispatchStartedRef = React.useRef(false)
  const stopRequestedRef = React.useRef(false)
  const retryInterruptAfterSubmitRef = React.useRef(false)
  const sessionCreationRef = React.useRef<Promise<string> | null>(null)
  const sessionGenerationRef = React.useRef(0)
  const pendingBySessionRef = React.useRef<Record<string, { draft: string; attachments: PendingAttachment[] }>>({})
  const interruptedSessionsRef = React.useRef(new Set<string>())
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
  const [sessionsState, setSessionsState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const sessionsRequestRef = React.useRef(0)
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
    if (!id || id !== sessionRef.current) {
      if (id && data.kind === 'message.complete') void loadSessions(true)
      return
    }
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
      }
      void chat.usage(id).then(result => {
        if (sessionRef.current === id && (result.context_max ?? result.context_length)) setChatUsage(result)
      }).catch(() => {})
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
      const interrupted = interruptedSessionsRef.current.has(storedSessionRef.current)
      setCanContinue(interrupted)
      setChatStatus(interrupted ? t("ui.requested.to.stop.current.task")
        : data.payload?.status === 'error' ? t("ui.response.failed") : t("ui.response.complete"))
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
    if (sessionCreationRef.current) return sessionCreationRef.current
    setSessionCreating(true)
    const generation = sessionGenerationRef.current
    const creation = (async () => {
      const created = await chat.createSession(workspacePath || undefined)
      if (generation !== sessionGenerationRef.current) throw new Error('Session creation was cancelled')
      const id = created.session_id
      sessionRef.current = id
      epochRef.current[id] = backend?.replay_epoch || ''
      lastSeqRef.current[id] = 0
      storedSessionRef.current = created.stored_session_id
      setSessionId(id)
      setSessionWorkspacePath(workspacePath ? created.info?.cwd || workspacePath : '')
      setSessionCurrentDirectory(created.info?.cwd || workspacePath)
      setActiveModel(created.info?.provider && created.info.model ? { provider: created.info.provider, model: created.info.model } : null)
      await loadSessions(true)
      return id
    })()
    sessionCreationRef.current = creation
    try { return await creation }
    finally {
      if (sessionCreationRef.current === creation) {
        sessionCreationRef.current = null
        setSessionCreating(false)
      }
    }
  }

  React.useEffect(() => {
    if (!backend) {
      setReasoningEffort('')
      setReasoningLoadFailed(false)
      setChatUsage(null)
      return
    }
    let active = true
    if (!reasoningChangeInFlightRef.current) setReasoningEffort('')
    setReasoningLoadFailed(false)
    if (!sessionId) setChatUsage(null)
    void Promise.allSettled([
      chat.reasoning(sessionId),
      sessionId ? chat.usage(sessionId) : Promise.resolve(null),
    ]).then(([reasoning, usage]) => {
      if (!active || sessionRef.current !== sessionId) return
      if (!reasoningChangeInFlightRef.current) {
        if (reasoning.status === 'fulfilled' && reasoning.value.value) setReasoningEffort(reasoning.value.value)
        else setReasoningLoadFailed(true)
      }
      if (usage.status === 'fulfilled' && usage.value) setChatUsage(usage.value)
    })
    return () => { active = false }
  }, [backend, sessionId, activeModel?.provider, activeModel?.model, chatVisible])

  React.useEffect(() => {
    if (!backend || !sessionId || !turnBusy || (chatUsage?.context_max ?? chatUsage?.context_length)) return
    let active = true
    const timer = window.setInterval(() => {
      void chat.usage(sessionId).then(result => {
        if (active && sessionRef.current === sessionId && (result.context_max ?? result.context_length)) setChatUsage(result)
      }).catch(() => {})
    }, 1500)
    return () => { active = false; window.clearInterval(timer) }
  }, [backend, sessionId, turnBusy, chatUsage?.context_max, chatUsage?.context_length])

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
      let request: Promise<CommandCatalog>
      request = ensureChatSession()
        .then(async id => {
          const catalog = await chat.commands(id)
          if (sessionRef.current === id) {
            setCommandCatalog(catalog)
            setCommandCatalogError(catalog.warning || '')
          }
          return catalog
        })
        .catch(cause => {
          if (commandCatalogPromiseRef.current === request) {
            commandCatalogPromiseRef.current = null
            setCommandCatalogError(t("ui.command.directory.read.failed.arg", describeError(cause, language)))
          }
          throw cause
        })
      commandCatalogPromiseRef.current = request
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

  async function sendMessage(overrideText?: string) {
    const refs = attachments.filter(item => item.kind === 'file' && item.ref_text).map(item => item.ref_text)
    const typed = draft.trim() || overrideText?.trim() || ''
    let text = [typed, ...refs].filter(Boolean).join('\n') || (attachments.length ? t("ui.please.see.attachment") : '')
    if (!text || turnBusy || submittingRef.current || attachmentBusy || reasoningChangeInFlightRef.current) return
    const slash = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(typed)
    const mentions = Array.from(typed.matchAll(/(^|\s)@([^\s]+)/g))
    let catalog: CommandCatalog | null = null
    if (slash || mentions.length) {
      submittingRef.current = true
      setNavigationBusy(true)
      try { catalog = await loadCommandCatalog() }
      catch { if (slash) return }
      finally { submittingRef.current = false; setNavigationBusy(false) }
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
    let idForSubmission = sessionRef.current
    stopRequestedRef.current = false
    retryInterruptAfterSubmitRef.current = false
    promptDispatchStartedRef.current = false
    submittingRef.current = true
    setNavigationBusy(true)
    setTurnBusy(true)
    setChatStatus(t("ui.submitting"))
    try {
      if (commandName === '/new' && isCommand) {
        submittingRef.current = false
        await newChat(false)
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
      idForSubmission = id
      if (stopRequestedRef.current) return
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
      if (stopRequestedRef.current) return
      const startedAt = Date.now()
      turnStartedAtRef.current = startedAt
      setConversation(rows => appendMessage(rows, 'user', typed || text, startedAt))
      setDraft('')
      promptDispatchStartedRef.current = true
      const result = await chat.submitPrompt(id, text)
      if (!stopRequestedRef.current) {
        interruptedSessionsRef.current.delete(storedSessionRef.current)
        setCanContinue(false)
      }
      if (retryInterruptAfterSubmitRef.current && sessionRef.current === id) {
        retryInterruptAfterSubmitRef.current = false
        await interruptSession()
      }
      if (sessionRef.current === id) {
        setAttachments([])
        if (!stopRequestedRef.current) {
          setChatStatus(previous => previous === t("ui.response.complete") ? previous : t("ui.received.arg", result.status || t('ui.waiting.for.events')))
        }
      }
    } catch (cause) {
      if (!stopRequestedRef.current && (!sessionRef.current || sessionRef.current === idForSubmission)) {
        setChatStatus(t("ui.submission.failed.arg.please.check.the.history.first.to.avoid.repeated.subm", describeError(cause, language)))
        finishCurrentTurn('failed')
        setTurnBusy(false)
      }
    } finally {
      submittingRef.current = false
      promptDispatchStartedRef.current = false
      setNavigationBusy(false)
    }
  }

  async function loadSessions(quiet = false) {
    const request = ++sessionsRequestRef.current
    if (!quiet) setSessionsState('loading')
    try {
      const result = await chat.listSessions()
      if (request !== sessionsRequestRef.current) return
      setSessions(result.sessions)
      setSessionsState('ready')
      if (!quiet) setChatStatus(t("ui.arg.historical.conversations.found", result.sessions.length))
    } catch (cause) {
      if (request !== sessionsRequestRef.current) return
      setSessionsState('error')
      setChatStatus(t("ui.failed.to.read.history.arg", describeError(cause, language)))
    }
  }

  async function newChat(preserveDraft = true) {
    if (submittingRef.current || sessionCreationRef.current || attachmentBusy || reasoningChangeInFlightRef.current || navigationBusyRef.current) return
    navigationBusyRef.current = true
    setNavigationBusy(true)
    if (storedSessionRef.current) pendingBySessionRef.current[storedSessionRef.current] = { draft: preserveDraft ? draft : '', attachments }
    if (storedSessionRef.current) void loadSessions(true)
    sessionRef.current = ''
    turnStartedAtRef.current = null
    storedSessionRef.current = ''
    setSessionId('')
    setSessionWorkspacePath('')
    setSessionCurrentDirectory('')
    setReasoningEffort('')
    setActiveModel(null)
    setModelPickerOpen(false)
    setConversation([])
    assistantRef.current = ''
    setAssistant('')
    setServerRequests([])
    setClarifyDraft({ requestId: '', answers: {} })
    setDraft('')
    setAttachments([])
    setChatUsage(null)
    setCanContinue(false)
    setCommandCatalog(null)
    commandCatalogPromiseRef.current = null
    setChatStatus(t("ui.new.session.ready"))
    navigationBusyRef.current = false
    setNavigationBusy(false)
  }

  async function resumeSession(id: string, force = false, replayEpoch = backend?.replay_epoch || '') {
    if (submittingRef.current || sessionCreationRef.current || attachmentBusy || reasoningChangeInFlightRef.current || navigationBusyRef.current || (!force && id === storedSessionRef.current)) return
    navigationBusyRef.current = true
    setNavigationBusy(true)
    setChatStatus(t("ui.resuming.session"))
    try {
      const result = await chat.resumeSession(id)
      if (storedSessionRef.current) pendingBySessionRef.current[storedSessionRef.current] = { draft, attachments }
      turnStartedAtRef.current = null
      sessionRef.current = result.session_id
      storedSessionRef.current = result.stored_session_id || result.session_key || id
      epochRef.current[result.session_id] = replayEpoch
      lastSeqRef.current[result.session_id] = result.last_sequence || 0
      setServerRequests((result.open_requests || []).filter(request => request.method === 'approval' || request.method === 'clarify'))
      setClarifyDraft({ requestId: '', answers: {} })
      setSessionId(result.session_id)
      setSessionWorkspacePath(selectedWorkspacePath(result.info))
      setSessionCurrentDirectory(result.info?.cwd || '')
      setReasoningEffort('')
      setActiveModel(result.info?.provider && result.info.model ? { provider: result.info.provider, model: result.info.model } : null)
      setModelPickerOpen(false)
      const pending = pendingBySessionRef.current[storedSessionRef.current]
      setDraft(pending?.draft || '')
      setAttachments(pending?.attachments || [])
      setCanContinue(!result.running && interruptedSessionsRef.current.has(storedSessionRef.current))
      setCommandCatalog(null)
      commandCatalogPromiseRef.current = null
      setConversation(historyTimeline(result.messages))
      assistantRef.current = result.inflight?.assistant || ''
      setAssistant(assistantRef.current)
      setTurnBusy(Boolean(result.running))
      setChatStatus(result.running ? t("ui.restored.task.still.running") : t("ui.session.resumed"))
    } catch (cause) { setChatStatus(t("ui.restore.failed.arg", describeError(cause, language))) }
    finally { navigationBusyRef.current = false; setNavigationBusy(false) }
  }

  async function interruptSession() {
    if (submittingRef.current && !promptDispatchStartedRef.current) {
      stopRequestedRef.current = true
      setChatStatus(t("ui.requested.to.stop.current.task"))
      setTurnBusy(false)
      return
    }
    const targetSessionId = sessionRef.current
    if (!targetSessionId) return
    const targetStoredId = storedSessionRef.current
    stopRequestedRef.current = true
    try {
      const result = await chat.interruptSession(targetSessionId)
      if (result.status === 'interrupted' && targetStoredId) interruptedSessionsRef.current.add(targetStoredId)
      if (sessionRef.current !== targetSessionId) return
      if (result.status !== 'interrupted' && submittingRef.current) retryInterruptAfterSubmitRef.current = true
      setChatStatus(result.status === 'interrupted' ? t("ui.requested.to.stop.current.task") : t("ui.there.are.currently.no.tasks.running"))
      if (result.status === 'interrupted') {
        finishCurrentTurn('interrupted')
        setCanContinue(true)
      }
      else setConversation(finishReasoning)
      setTurnBusy(false)
    } catch (cause) {
      if (sessionRef.current === targetSessionId) setChatStatus(t("ui.failed.to.stop.task.arg", describeError(cause, language)))
    }
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
        for (const pending of Object.values(pendingBySessionRef.current)) {
          pending.attachments = pending.attachments.filter(item => item.kind === 'file')
        }
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
        setSessionWorkspacePath(selectedWorkspacePath(snapshot.info))
        setSessionCurrentDirectory(snapshot.info?.cwd || '')
        setActiveModel(snapshot.info?.provider && snapshot.info.model ? { provider: snapshot.info.provider, model: snapshot.info.model } : null)
        setClarifyDraft({ requestId: '', answers: {} })
        const buffered = bufferedEventsRef.current.splice(0)
          .sort((a, b) => (a.seq || 0) - (b.seq || 0))
        setServerRequests(mergeRecoveredRequests(
          id, replay?.open_requests || snapshot.open_requests || [], bufferedRequestsRef.current.splice(0),
          replay?.events || [], buffered,
        ))
        setTurnBusy(Boolean(snapshot.running))
        setCanContinue(!snapshot.running && interruptedSessionsRef.current.has(storedSessionRef.current))
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
        for (const event of buffered) eventProcessorRef.current(event)
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


  function resetChat(clearDraft = false) {
    if (clearDraft) setDraft('')
    sessionsRequestRef.current += 1
    sessionGenerationRef.current += 1
    pendingBySessionRef.current = {}
    interruptedSessionsRef.current.clear()
    navigationBusyRef.current = false
    submittingRef.current = false
    sessionCreationRef.current = null
    setNavigationBusy(false)
    setSessionCreating(false)
    sessionRef.current = ''
    turnStartedAtRef.current = null
    storedSessionRef.current = ''
    setSessionId('')
    setSessionWorkspacePath('')
    setSessionCurrentDirectory('')
    setConversation([])
    assistantRef.current = ''
    setAssistant('')
    setServerRequests([])
    setClarifyDraft({ requestId: '', answers: {} })
    setSessions([])
    setSessionsState('loading')
    setAttachments([])
    setCommandCatalog(null)
    commandCatalogPromiseRef.current = null
    setChatUsage(null)
    setTurnBusy(false)
    setCanContinue(false)
  }

  return {
    sessionId, sessionWorkspacePath, sessionCurrentDirectory, reasoningEffort, reasoningLoadFailed, reasoningBusy, chatUsage, sessionRef, storedSessionRef,
    draft, setDraft, commandCatalog, commandCatalogError, activeChoice, setActiveChoice,
    draftCaret, setDraftCaret, draftInputRef, conversation, assistant, chatStatus, setChatStatus,
    turnBusy, canContinue, navigationBusy, sessionCreating, serverRequest, clarifyAnswers, setClarifyAnswer, sessions, sessionsState, attachments,
    attachmentBusy, draggingFiles, trigger, choices, answerRequest, ensureChatSession,
    changeReasoning, chooseCommand, chooseAttachments, removeAttachment, sendMessage,
    loadSessions, newChat, resumeSession, interruptSession, reconnectBackend, resetChat,
  }
}
