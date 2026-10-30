import React from 'react'
import type { BackendInfo, GatewayEvent, ReplayResult, ResumeResult, GatewayRequest, ApprovalChoice, SessionRow, ProfileScope, SessionScope } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileRef, useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import { describeError } from '../../app/desktopErrors'
import { commandSupported, commandChoices, composerTrigger, type PendingAttachment, type CommandCatalog, type ComposerChoice, type ChatUsage } from './model'
import { savedModelFromOptions, type ModelPick } from '../models/model'
import { appendMessage, appendReasoning, finishReasoning, finishTurn, historyTimeline, pauseReasoning, updateTool, type TimelineItem } from './timeline'
import { mergeRecoveredRequests } from './requestRecovery'
import { composeClarifyAnswer } from './clarifyAnswer'
import { argumentAllowed, argumentHint as commandArgumentHint } from './commandArguments'
import { runSaveCommand } from './saveCommand'
import { useRetryRefresh } from './retryRefresh'

type Options = {
  backend: BackendInfo | null
  profile: string | null
  chatVisible: boolean
  activeModel: ModelPick | null
  language: 'zh-CN' | 'en-US'
  storagePath: string
  workspacePath: string
  t: (key: string, ...values: unknown[]) => string
  openChat: () => void
  openModelSettings: () => void
  openCommandPage: (name: string) => boolean
  onCommandFinished: (profile: string, sessionId: string) => void
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActiveModel: React.Dispatch<React.SetStateAction<ModelPick | null>>
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setBackend: (next: BackendInfo | null) => void
  setBackendStatus: React.Dispatch<React.SetStateAction<string>>
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
}

function selectedWorkspacePath(info?: ResumeResult['info']): string {
  return info?.launch_request?.cwd_explicit === true ? info.cwd || info.launch_request.cwd || '' : ''
}

export function useChatController({ backend, profile, chatVisible, activeModel, language, storagePath, workspacePath, t, openChat, openModelSettings, openCommandPage, onCommandFinished, setSidebarOpen, setActiveModel, setModelPickerOpen, setBackend, setBackendStatus, setBusy }: Options) {
  const { events, nativeFiles, chat, models, runtime, diagnostics } = useDesktop()
  const workspace = workspaceKey(backend?.replay_epoch, profile)
  let stateSlot = 0
  const useState = <T,>(initial: T | (() => T)) => useProfileState(workspace, initial, `chat:${stateSlot++}`)
  const useRef = <T,>(initial: T) => useProfileRef(workspace, initial)
  const viewedProfileRef = useRef(profile)
  viewedProfileRef.current = profile
  const sessionProfileRef = useRef('')
  function profileScope(): ProfileScope {
    const owner = viewedProfileRef.current
    if (!owner) throw new Error('No active Profile')
    return { kind: 'profile', profile: owner }
  }
  function sessionScope(id: string): SessionScope {
    const owner = sessionProfileRef.current
    if (!owner || !id) throw new Error('Session has no Profile owner')
    return { kind: 'session', profile: owner, sessionId: id }
  }
  const [sessionId, setSessionId] = useState('')
  const lastSessionByProfile = React.useRef<Record<string, string>>({})
  const attemptedEpochResume = React.useRef(new Set<string>())
  const [sessionWorkspacePath, setSessionWorkspacePath] = useState('')
  const [sessionCurrentDirectory, setSessionCurrentDirectory] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('')
  const [reasoningLoadFailed, setReasoningLoadFailed] = useState(false)
  const [reasoningRefreshVersion, setReasoningRefreshVersion] = useState(0)
  const [reasoningBusy, setReasoningBusy] = useState(false)
  const draftReasoningRef = useRef('')
  const reasoningChangeInFlightRef = useRef(false)
  const reasoningSessionRef = useRef<string | null>(null)
  const [chatUsage, setChatUsage] = useState<ChatUsage | null>(null)
  const sessionRef = useRef('')
  const storedSessionRef = useRef('')
  const [draft, setDraft] = useState('')
  const [commandCatalog, setCommandCatalog] = useState<CommandCatalog | null>(null)
  const [commandCatalogError, setCommandCatalogError] = useState('')
  const [activeChoice, setActiveChoice] = useState(0)
  const [draftCaret, setDraftCaret] = useState(0)
  const commandCatalogPromiseRef = useRef<Promise<CommandCatalog> | null>(null)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [conversation, setConversation] = useState<TimelineItem[]>([])
  const [assistant, setAssistant] = useState('')
  const assistantRef = useRef('')
  const [chatStatus, setChatStatus] = useState('')
  const [turnBusy, setTurnBusy] = useState(false)
  const [canContinue, setCanContinue] = useState(false)
  const [navigationBusy, setNavigationBusy] = useState(false)
  const [sessionCreating, setSessionCreating] = useState(false)
  const navigationBusyRef = useRef(false)
  const submittingRef = useRef(false)
  const promptDispatchStartedRef = useRef(false)
  const stopRequestedRef = useRef(false)
  const retryInterruptAfterSubmitRef = useRef(false)
  const retryPendingRef = useRef('')
  const sessionCreationRef = useRef<Promise<string> | null>(null)
  const sessionGenerationRef = useRef(0)
  const pendingBySessionRef = useRef<Record<string, { draft: string; attachments: PendingAttachment[] }>>({})
  const interruptedSessionsRef = useRef(new Set<string>())
  const turnStartedAtRef = useRef<number | null>(null)
  const [serverRequests, setServerRequests] = useState<GatewayRequest[]>([])
  const serverRequest = serverRequests[0] || null
  const [clarifyDraft, setClarifyDraft] = useState<{ requestId: string; answers: Record<string, string> }>({ requestId: '', answers: {} })
  const clarifyAnswers = clarifyDraft.requestId === serverRequest?.id ? clarifyDraft.answers : {}
  function setClarifyAnswer(qid: string, value: string) {
    if (!serverRequest || serverRequest.method !== 'clarify') return
    setClarifyDraft(current => ({
      requestId: serverRequest.id,
      answers: { ...(current.requestId === serverRequest.id ? current.answers : {}), [qid]: value },
    }))
  }
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionsState, setSessionsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const sessionsRequestRef = useRef(0)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const lastSeqRef = useRef<Record<string, number>>({})
  const epochRef = useRef<Record<string, string>>({})
  const recoveringRef = useRef(false)
  const bufferedEventsRef = useRef<GatewayEvent[]>([])
  const bufferedRequestsRef = useRef<GatewayRequest[]>([])
  const eventProcessorRef = useRef<(data: GatewayEvent) => void>(() => {})
  const currentEpochRef = React.useRef(backend?.replay_epoch)
  if (backend?.replay_epoch) currentEpochRef.current = backend.replay_epoch
  const eventProcessors = React.useRef<Record<string, (data: GatewayEvent) => void>>({})
  const requestProcessors = React.useRef<Record<string, (request: GatewayRequest) => void>>({})
  const disconnectProcessors = React.useRef<Record<string, () => void>>({})

  eventProcessorRef.current = data => {
    const id = data.session_id
    if (!data.profile || data.profile !== sessionProfileRef.current) return
    if (!id || id !== sessionRef.current) {
      if (id && data.kind === 'message.complete') void loadSessions(true)
      return
    }
    if (typeof data.seq === 'number') {
      if (data.seq <= (lastSeqRef.current[id] || 0)) return
      lastSeqRef.current[id] = data.seq
    }
    if ((data.kind === 'reasoning.delta' || data.kind === 'reasoning.available') && typeof data.payload?.text === 'string') {
      setConversation(rows => appendReasoning(rows, data.payload.text as string, data.kind === 'reasoning.available', !assistantRef.current.trim()))
    } else if (data.kind === 'message.delta' && typeof data.payload?.text === 'string') {
      if (data.payload.text.trim()) setConversation(finishReasoning)
      assistantRef.current += data.payload.text
      setAssistant(assistantRef.current)
    } else if (data.kind === 'message.complete') {
      const usage = data.payload?.usage
      if (usage && typeof usage === 'object' && ('context_used' in usage || 'context_max' in usage)) {
        setChatUsage(usage as ChatUsage)
      }
      void chat.usage(sessionScope(id)).then(result => {
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
      setConversation(rows => updateTool(pauseReasoning(rows), data.kind as 'tool.start' | 'tool.complete', data.payload || {}))
      setChatStatus(t("ui.arg.arg", t(data.kind === 'tool.start' ? 'ui.calling' : 'ui.tool.finished'), String(data.payload?.name || t("ui.tool"))))
    } else if (data.kind === 'request.cancel') {
      setServerRequests(current => current.filter(request => request.id !== data.payload?.id))
      setClarifyDraft(current => current.requestId === data.payload?.id ? { requestId: '', answers: {} } : current)
    }
  }
  eventProcessors.current[workspace] = data => {
    if (recoveringRef.current) bufferedEventsRef.current.push(data)
    else eventProcessorRef.current(data)
  }
  requestProcessors.current[workspace] = request => {
    if (recoveringRef.current) bufferedRequestsRef.current.push(request)
    else if (request.params.session_id === sessionRef.current) {
      setServerRequests(current => current.some(item => item.id === request.id) ? current : [...current, request])
    }
  }
  disconnectProcessors.current[workspace] = () => {
    setChatStatus(t("ui.connection.interrupted.please.check.the.connection.before.resuming.the.sess"))
    setConversation(finishReasoning)
    setTurnBusy(false)
    setServerRequests([])
    setClarifyDraft({ requestId: '', answers: {} })
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
      if (data.profile) eventProcessors.current[workspaceKey(currentEpochRef.current, data.profile)]?.(data)
    }).then(fn => { if (active) unlistenEvent = fn; else fn() })
    void events.onGatewayRequest(request => {
      if (active && request.profile) requestProcessors.current[workspaceKey(currentEpochRef.current, request.profile)]?.(request)
    }).then(fn => { if (active) unlistenRequest = fn; else fn() })
    void events.onDisconnect(() => {
      if (!active) return
      const prefix = `${currentEpochRef.current || 'offline'}\u0000`
      for (const [key, process] of Object.entries(disconnectProcessors.current)) {
        if (key.startsWith(prefix)) process()
      }
    }).then(fn => { if (active) unlistenDisconnect = fn; else fn() })
    return () => { active = false; unlistenEvent?.(); unlistenRequest?.(); unlistenDisconnect?.() }
  }, [])

  async function answerRequest(choice?: ApprovalChoice, supplements: Record<string, string> = {}) {
    if (!serverRequest) return
    const request = serverRequest
    try {
      await chat.answerRequest(sessionScope(request.params.session_id), {
        requestId: request.id,
        method: request.method,
        choice,
        answers: request.method === 'clarify'
          ? Object.fromEntries(request.params.questions.map(question => [
            question.qid, composeClarifyAnswer(
              clarifyAnswers[question.qid] ?? request.params.answers?.[question.qid],
              supplements[question.qid],
              question.multi_select,
            ),
          ]))
          : undefined,
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
      const owner = profileScope()
      let selectedModel = activeModel
      if (!selectedModel) {
        const [configResult, optionsResult] = await Promise.allSettled([
          models.savedConfig(owner),
          models.options(owner, { refresh: false, includeUnconfigured: false }),
        ])
        if (configResult.status === 'rejected' && optionsResult.status === 'rejected') throw configResult.reason
        const saved = savedModelFromOptions(
          optionsResult.status === 'fulfilled' ? optionsResult.value : { providers: [] },
          configResult.status === 'fulfilled' ? configResult.value : { provider: '', model: '', base_url: '' },
        )
        if (!saved?.provider || !saved.model) throw new Error(t('ui.select.model.before.sending'))
        selectedModel = { provider: saved.provider, model: saved.model }
      }
      const created = await chat.createSession(owner, {
        cwd: workspacePath || undefined,
        provider: selectedModel.provider,
        model: selectedModel.model,
        reasoning: draftReasoningRef.current || undefined,
      })
      if (generation !== sessionGenerationRef.current) throw new Error('Session creation was cancelled')
      const id = created.session_id
      sessionProfileRef.current = owner.profile
      sessionRef.current = id
      setCommandCatalog(null)
      setCommandCatalogError('')
      commandCatalogPromiseRef.current = null
      epochRef.current[id] = backend?.replay_epoch || ''
      lastSeqRef.current[id] = 0
      storedSessionRef.current = created.stored_session_id
      lastSessionByProfile.current[owner.profile] = created.stored_session_id
      setSessionId(id)
      reasoningSessionRef.current = id
      setSessionWorkspacePath(workspacePath ? created.info?.cwd || workspacePath : '')
      setSessionCurrentDirectory(created.info?.cwd || workspacePath)
      setActiveModel(created.info?.provider && created.info.model ? { provider: created.info.provider, model: created.info.model } : selectedModel)
      void loadSessions(true)
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
    if (!backend || !profile) {
      setReasoningEffort('')
      setReasoningLoadFailed(false)
      setChatUsage(null)
      return
    }
    let active = true
    if (reasoningSessionRef.current !== sessionId) {
      reasoningSessionRef.current = sessionId
      if (!reasoningChangeInFlightRef.current && (sessionId || !draftReasoningRef.current)) setReasoningEffort('')
    }
    setReasoningLoadFailed(false)
    if (!sessionId) setChatUsage(null)
    void Promise.allSettled([
      chat.reasoning(sessionId ? sessionScope(sessionId) : profileScope()),
      sessionId ? chat.usage(sessionScope(sessionId)) : Promise.resolve(null),
    ]).then(([reasoning, usage]) => {
      if (!active || sessionRef.current !== sessionId) return
      if (!reasoningChangeInFlightRef.current) {
        if (reasoning.status === 'fulfilled') {
          if (sessionId || !draftReasoningRef.current) setReasoningEffort(reasoning.value.value || '')
        } else if (!draftReasoningRef.current) setReasoningLoadFailed(true)
      }
      if (usage.status === 'fulfilled' && usage.value) setChatUsage(usage.value)
    })
    return () => { active = false }
  }, [backend, profile, sessionId, activeModel?.provider, activeModel?.model, chatVisible, reasoningRefreshVersion])

  React.useEffect(() => {
    if (!backend || !sessionId || !turnBusy || (chatUsage?.context_max ?? chatUsage?.context_length)) return
    let active = true
    const timer = window.setInterval(() => {
      void chat.usage(sessionScope(sessionId)).then(result => {
        if (active && sessionRef.current === sessionId && (result.context_max ?? result.context_length)) setChatUsage(result)
      }).catch(() => {})
    }, 1500)
    return () => { active = false; window.clearInterval(timer) }
  }, [backend, sessionId, turnBusy, chatUsage?.context_max, chatUsage?.context_length])

  async function changeReasoning(value: string) {
    if (reasoningChangeInFlightRef.current || !backend || !value) return
    if (!sessionRef.current) {
      draftReasoningRef.current = value
      setReasoningEffort(value)
      setReasoningLoadFailed(false)
      return
    }
    reasoningChangeInFlightRef.current = true
    setReasoningBusy(true)
    try {
      const id = sessionRef.current
      const saved = await chat.setReasoning(sessionScope(id), value)
      if (saved.value !== value) throw new Error(language === 'zh-CN' ? '后端未确认思考强度修改' : 'The backend did not confirm the reasoning change')
      const current = await chat.reasoning(sessionScope(id))
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
      const id = sessionRef.current
      const scope = id ? sessionScope(id) : profileScope()
      setCommandCatalogError('')
      request = chat.commands(scope)
        .then(catalog => {
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
    if (backend && profile && composerTrigger(draft, draftCaret) && !commandCatalog) {
      void loadCommandCatalog().catch(() => {})
    }
  }, [backend, profile, sessionId, draft, draftCaret, commandCatalog])

  const trigger = composerTrigger(draft, draftCaret)
  const argumentHint = trigger && 'command' in trigger ? commandArgumentHint(commandCatalog, trigger.command, language) : ''
  const choices = commandCatalog && trigger ? commandChoices(commandCatalog, trigger, language) : []
  function chooseCommand(choice: ComposerChoice) {
    if (!trigger) return
    if (!choice.available) { setChatStatus(`${choice.name}：${choice.availability}`); return }
    const replacement = `${choice.insertion || choice.name} `
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
      const existing = new Set(attachments.map(item => item.source_path))
      for (const path of paths) {
        if (existing.has(path)) continue
        const attached = sessionRef.current
          ? await chat.attachFile(sessionScope(sessionRef.current), path)
          : await chat.inspectFile(path)
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

  async function pasteImages(images: File[]) {
    if (!backend || turnBusy || attachmentBusy || navigationBusy || !images.length) return
    if (images.length + attachments.length > 10) { setChatStatus(t('ui.up.to.10.attachments.can.be.temporarily.saved.per.round')); return }
    setAttachmentBusy(true)
    try {
      for (const image of images) {
        if (!image.size || image.size > 20 * 1024 * 1024) throw new Error(language === 'zh-CN' ? '图片不能为空，且不能超过 20 MiB' : 'Image must be between 1 byte and 20 MiB')
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(image)
        })
        const name = image.name || 'pasted-image.png'
        const attached: PendingAttachment = sessionRef.current
          ? await chat.attachImageBytes(sessionScope(sessionRef.current), contentBase64, name)
          : { kind: 'image', name, source_path: 'clipboard', bytes: image.size, content_base64: contentBase64 }
        attached.image_preview = `data:${image.type || 'image/png'};base64,${contentBase64}`
        setAttachments(current => [...current, attached])
      }
      setChatStatus(t('ui.arg.attachments.staged.they.will.be.included.with.the.next.message', images.length))
    } catch (cause) { setChatStatus(t('ui.failed.to.temporarily.save.attachment.arg', describeError(cause, language))) }
    finally { setAttachmentBusy(false) }
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
        await chat.detachImage(sessionScope(sessionRef.current), attachment.path)
      }
      setAttachments(current => current.filter((_, position) => position !== index))
    } catch (cause) { setChatStatus(t("ui.failed.to.remove.attachment.arg", describeError(cause, language))) }
    finally { setAttachmentBusy(false) }
  }

  async function sendMessage(overrideText?: string, quickInput = false) {
    if (quickInput && (draft.trim() || attachments.length || navigationBusyRef.current || sessionCreationRef.current)) return false
    let refs = attachments.filter(item => item.kind === 'file' && item.ref_text).map(item => item.ref_text)
    const typed = (quickInput ? overrideText?.trim() : draft.trim() || overrideText?.trim()) || ''
    let text = [typed, ...refs].filter(Boolean).join('\n') || (attachments.length ? t("ui.please.see.attachment") : '')
    if (typed === '/stop' && !attachments.length && !attachmentBusy) {
      if (sessionRef.current || submittingRef.current) await interruptSession()
      else setChatStatus(t('ui.there.are.currently.no.tasks.running'))
      setDraft('')
      return true
    }
    if (!text || turnBusy || submittingRef.current || attachmentBusy || reasoningChangeInFlightRef.current) return
    const slash = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(typed)
    if (slash && ['retry', 'compress', 'agents', 'branch'].includes(slash[1]) && !sessionRef.current) { setChatStatus(language === 'zh-CN' ? '当前没有可操作的会话。' : 'There is no current session for this command.'); return false }
    if (slash?.[1] === 'save') {
      if (turnBusy || submittingRef.current || attachmentBusy || reasoningChangeInFlightRef.current) return false
      if (attachments.length) { setChatStatus(t('ui.please.remove.the.attachment.first.when.executing.the.command')); return false }
      const owner = sessionProfileRef.current
      const id = sessionRef.current
      return runSaveCommand({ arg: slash[2] || '', exportSession: chat.exportSession,
        scope: owner && id ? { kind: 'session', profile: owner, sessionId: id } : null,
        isCurrent: () => sessionRef.current === id && sessionProfileRef.current === owner,
        language, busy: submittingRef, setBusy: setNavigationBusy,
        setDraft, setStatus: setChatStatus, describeError: cause => describeError(cause, language) })
    }
    if (slash && ['/new', '/sessions', '/model', '/history', '/resume', '/config', '/tools', '/toolsets', '/cron', '/plugins'].includes(`/${slash[1]}`)) {
      if (attachments.length) {
        setChatStatus(t('ui.please.remove.the.attachment.first.when.executing.the.command'))
        return
      }
      if (slash[1] === 'resume' && slash[2]?.trim()) {
        const owner = viewedProfileRef.current
        try {
          const result = await chat.listSessions(profileScope())
          if (viewedProfileRef.current !== owner) return false
          const target = slash[2].trim()
          const exact = result.sessions.filter(row => row.id === target)
          const matches = exact.length ? exact : result.sessions.filter(row => row.title === target)
          if (matches.length !== 1) throw new Error(language === 'zh-CN' ? '会话不存在或名称重复，请在历史列表选择。' : 'Session missing or ambiguous. Choose it from history.')
          return await resumeSession(matches[0].id, false, backend?.replay_epoch || '', owner, true)
        } catch (cause) { setChatStatus(describeError(cause, language)); return false }
      }
      if (slash[2]?.trim()) {
        setChatStatus(language === 'zh-CN' ? '此桌面命令不接受参数，请在打开的页面操作。' : 'This desktop command takes no arguments. Use the page it opens.')
        return
      }
      if (slash[1] === 'new') await newChat(false)
      else if (['sessions', 'history', 'resume'].includes(slash[1])) { await loadSessions(true); openChat(); setSidebarOpen(true); setDraft('') }
      else if (slash[1] === 'model') { openModelSettings(); setDraft('') }
      else if (openCommandPage(slash[1])) setDraft('')
      return true
    }
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
    if (isCommand && catalog && !argumentAllowed(catalog, commandName, commandArg)) {
      setChatStatus(language === 'zh-CN' ? '该命令参数不适用于桌面，请按候选中的子命令输入；审批模式请在安全设置中调整。' : 'These arguments are unavailable on desktop. Use a suggested subcommand or change approval mode in Security settings.')
      return
    }
    if (isCommand && attachments.length && !isSkill) { setChatStatus(t("ui.please.remove.the.attachment.first.when.executing.the.command")); return }
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
    // Show the prompt before model lookup and session creation finish.
    const optimisticStartedAt = !isCommand ? Date.now() : null
    if (optimisticStartedAt != null) {
      turnStartedAtRef.current = optimisticStartedAt
      setConversation(rows => appendMessage(rows, 'user', typed || text, optimisticStartedAt))
      setDraft('')
    }
    const restoreUnsentPrompt = () => {
      if (optimisticStartedAt == null) return
      setConversation(rows => rows.filter(row => row.kind !== 'message' || row.role !== 'user' || row.startedAt !== optimisticStartedAt))
      setDraft(draft)
      turnStartedAtRef.current = null
    }
    try {
      const id = await ensureChatSession()
      idForSubmission = id
      if (stopRequestedRef.current) { restoreUnsentPrompt(); return }
      if (attachments.some(item => !item.path && !item.ref_text)) {
        const prepared: PendingAttachment[] = []
        for (const attachment of attachments) {
          prepared.push(attachment.path || attachment.ref_text
            ? attachment
            : attachment.content_base64
              ? { ...await chat.attachImageBytes(sessionScope(id), attachment.content_base64, attachment.name), image_preview: attachment.image_preview }
              : await chat.attachFile(sessionScope(id), attachment.source_path))
          setAttachments([...prepared, ...attachments.slice(prepared.length)])
        }
        refs = prepared.filter(item => item.kind === 'file' && item.ref_text).map(item => item.ref_text!)
        text = [typed, ...refs].filter(Boolean).join('\n') || t('ui.please.see.attachment')
      }
      if (isCommand) {
        const commandOwner = sessionProfileRef.current
        const result = isSkill
          ? await chat.dispatchSkill(sessionScope(id), commandName.slice(1), commandArg)
          : ['/retry', '/compress'].includes(commandName) ? { type: 'send', message: typed }
            : await chat.executeCommand(sessionScope(id), `${commandName}${commandArg ? ` ${commandArg}` : ''}`)
        if (result.type === 'skill' || result.type === 'send') {
          if (!result.message) throw new Error(t("ui.the.command.did.not.return.a.message.to.send"))
          text = [result.message, ...refs].filter(Boolean).join('\n')
        } else if (result.type === 'prefill') {
          onCommandFinished(sessionProfileRef.current, storedSessionRef.current || id)
          setDraft(result.message || '')
          setChatStatus(result.notice || t("ui.the.command.has.been.filled.in.the.input.box"))
          setTurnBusy(false)
          return true
        } else if (result.type === 'branch') {
          if (!result.message) throw new Error('Gateway did not return the branch session ID')
          onCommandFinished(commandOwner, storedSessionRef.current || id)
          setTurnBusy(false)
          if (sessionRef.current !== id || sessionProfileRef.current !== commandOwner) return true
          submittingRef.current = false
          setDraft('')
          const opened = await resumeSession(result.message, false, backend?.replay_epoch || '', commandOwner, true)
          if (!opened) setChatStatus(language === 'zh-CN' ? `分支已创建，请用 /resume ${result.message} 打开。` : `Branch created. Open it with /resume ${result.message}.`)
          return true
        } else if (result.type === 'exec' || result.type === 'plugin' || !result.type) {
          onCommandFinished(sessionProfileRef.current, storedSessionRef.current || id)
          if (commandName === '/reasoning' && sessionRef.current === id) setReasoningRefreshVersion(version => version + 1)
          setConversation(rows => appendMessage(appendMessage(rows, 'user', typed), 'assistant', result.output || result.notice || t("ui.command.execution.completed")))
          setDraft('')
          setChatStatus(t("ui.command.execution.completed"))
          setTurnBusy(false)
          return true
        } else {
          throw new Error(t("ui.this.command.return.type.is.not.supported.yet.arg", result.type))
        }
      }
      if (stopRequestedRef.current) { restoreUnsentPrompt(); return }
      const startedAt = optimisticStartedAt ?? Date.now()
      turnStartedAtRef.current = startedAt
      assistantRef.current = ''
      setAssistant('')
      if (optimisticStartedAt == null) {
        setConversation(rows => appendMessage(rows, 'user', typed || text, startedAt))
        setDraft('')
      }
      promptDispatchStartedRef.current = true
      if (commandName === '/retry') retryPendingRef.current = id
      const result = await chat.submitPrompt(sessionScope(id), text)
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
      return true
    } catch (cause) {
      if (isCommand && !promptDispatchStartedRef.current && sessionProfileRef.current && (storedSessionRef.current || idForSubmission)) {
        onCommandFinished(sessionProfileRef.current, storedSessionRef.current || idForSubmission)
      }
      if (!stopRequestedRef.current && (!sessionRef.current || sessionRef.current === idForSubmission)) {
        if (optimisticStartedAt != null && !promptDispatchStartedRef.current) {
          restoreUnsentPrompt()
        }
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

  async function loadSessions(quiet = false, ownerProfile = viewedProfileRef.current) {
    const request = ++sessionsRequestRef.current
    if (!quiet) setSessionsState('loading')
    try {
      if (!ownerProfile) throw new Error('No active Profile')
      const result = await chat.listSessions({ kind: 'profile', profile: ownerProfile })
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

  async function deleteSession(ownerProfile: string, id: string) {
    if (submittingRef.current || sessionCreationRef.current || attachmentBusy || reasoningChangeInFlightRef.current || navigationBusyRef.current) {
      throw new Error(language === 'zh-CN' ? '当前操作完成后再删除会话' : 'Wait for the current operation before deleting this session')
    }
    navigationBusyRef.current = true
    setNavigationBusy(true)
    try {
      await chat.deleteSession({
        kind: 'session', profile: ownerProfile, sessionId: id,
        keepView: ownerProfile === viewedProfileRef.current && (storedSessionRef.current === id || sessionRef.current === id),
        viewSessionId: ownerProfile === viewedProfileRef.current ? sessionRef.current : '',
      })
      delete pendingBySessionRef.current[id]
      interruptedSessionsRef.current.delete(id)
      if (lastSessionByProfile.current[ownerProfile] === id) delete lastSessionByProfile.current[ownerProfile]
      if (ownerProfile === viewedProfileRef.current) {
        if (storedSessionRef.current === id) {
          storedSessionRef.current = ''
          await newChat(false, true)
        }
        await loadSessions(true, ownerProfile)
      }
    } finally {
      navigationBusyRef.current = false
      setNavigationBusy(false)
    }
  }

  async function newChat(preserveDraft = true, afterDelete = false) {
    if (submittingRef.current || sessionCreationRef.current || attachmentBusy || reasoningChangeInFlightRef.current || (navigationBusyRef.current && !afterDelete)) return
    navigationBusyRef.current = true
    if (profile) delete lastSessionByProfile.current[profile]
    setNavigationBusy(true)
    if (storedSessionRef.current) pendingBySessionRef.current[storedSessionRef.current] = { draft: preserveDraft ? draft : '', attachments }
    if (storedSessionRef.current) void loadSessions(true)
    sessionRef.current = ''
    sessionProfileRef.current = ''
    turnStartedAtRef.current = null
    storedSessionRef.current = ''
    setSessionId('')
    setSessionWorkspacePath('')
    setSessionCurrentDirectory('')
    setReasoningEffort('')
    draftReasoningRef.current = ''
    reasoningSessionRef.current = null
    setActiveModel(null)
    setModelPickerOpen(false)
    setConversation([])
    assistantRef.current = ''
    setAssistant('')
    setTurnBusy(false)
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

  async function resumeSession(id: string, force = false, replayEpoch = backend?.replay_epoch || '', ownerProfile = viewedProfileRef.current, commandResume = false) {
    if (submittingRef.current || sessionCreationRef.current || attachmentBusy || reasoningChangeInFlightRef.current || navigationBusyRef.current || (!force && id === storedSessionRef.current)) return false
    navigationBusyRef.current = true
    setNavigationBusy(true)
    setChatStatus(t("ui.resuming.session"))
    try {
      if (!ownerProfile) throw new Error('Session has no Profile owner')
      const result = await chat.resumeSession({ kind: 'session', profile: ownerProfile, sessionId: id })
      if (storedSessionRef.current) pendingBySessionRef.current[storedSessionRef.current] = { draft: commandResume ? '' : draft, attachments }
      turnStartedAtRef.current = null
      sessionRef.current = result.session_id
      sessionProfileRef.current = ownerProfile
      storedSessionRef.current = result.stored_session_id || result.session_key || id
      lastSessionByProfile.current[ownerProfile] = storedSessionRef.current
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
      setConversation(historyTimeline(result.messages, Boolean(result.running)))
      assistantRef.current = result.inflight?.assistant || ''
      setAssistant(assistantRef.current)
      setTurnBusy(Boolean(result.running))
      setChatStatus(result.running ? t("ui.restored.task.still.running") : t("ui.session.resumed"))
      return true
    } catch (cause) { setChatStatus(t("ui.restore.failed.arg", describeError(cause, language))); return false }
    finally { navigationBusyRef.current = false; setNavigationBusy(false) }
  }

  useRetryRefresh(retryPendingRef, turnBusy, navigationBusy, backend, sessionId, storedSessionRef, sessionProfileRef, resumeSession)

  React.useEffect(() => {
    if (!backend?.replay_epoch || !profile || sessionId) return
    const remembered = lastSessionByProfile.current[profile]
    const attempt = `${backend.replay_epoch}\u0000${profile}`
    if (!remembered || attemptedEpochResume.current.has(attempt)) return
    attemptedEpochResume.current.add(attempt)
    void resumeSession(remembered, true, backend.replay_epoch, profile)
  }, [backend?.replay_epoch, profile, sessionId])

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
      const result = await chat.interruptSession(sessionScope(targetSessionId))
      if (result.status === 'interrupted' && targetStoredId) interruptedSessionsRef.current.add(targetStoredId)
      if (sessionRef.current !== targetSessionId) return
      if (result.status !== 'interrupted' && submittingRef.current) retryInterruptAfterSubmitRef.current = true
      setChatStatus(result.status === 'interrupted' ? t("ui.requested.to.stop.current.task") : t("ui.there.are.currently.no.tasks.running"))
      if (result.status === 'interrupted') {
        finishCurrentTurn('interrupted')
        setCanContinue(true)
        setTurnBusy(false)
      } else if (!submittingRef.current) {
        setConversation(finishReasoning)
        setTurnBusy(false)
      }
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
      const epochChanged = Boolean(backend?.replay_epoch && info.replay_epoch !== backend.replay_epoch)
      setBackend(info)
      setBackendStatus(epochChanged
        ? t("ui.reconnected.pictures.to.be.sent.need.to.be.added.again") : t("ui.reconnected"))
      if (epochChanged) {
        setAttachments(current => current.filter(item => item.kind === 'file'))
        for (const pending of Object.values(pendingBySessionRef.current)) {
          pending.attachments = pending.attachments.filter(item => item.kind === 'file')
        }
        if (profile && storedSessionRef.current) lastSessionByProfile.current[profile] = storedSessionRef.current
        return
      }
      if (storedSessionRef.current) {
        const snapshot = await chat.resumeSession(sessionScope(storedSessionRef.current))
        const id = snapshot.session_id
        const sameStream = id === previousId && Boolean(previousEpoch) && info.replay_epoch === previousEpoch
        let replay: ReplayResult | undefined
        if (sameStream) {
          replay = await chat.replayEvents(sessionScope(id), previousSeq, previousEpoch)
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
          setConversation(historyTimeline(snapshot.messages, Boolean(snapshot.running)))
          assistantRef.current = snapshot.inflight?.assistant || ''
          setAssistant(assistantRef.current)
          epochRef.current[id] = info.replay_epoch
          lastSeqRef.current[id] = snapshot.last_sequence || 0
        } else if (replay) {
          const ordered = replay.events.map(event => ({
            kind: event.type, profile: sessionProfileRef.current, session_id: event.session_id, seq: event.seq,
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
    draftReasoningRef.current = ''
    lastSessionByProfile.current = {}
    attemptedEpochResume.current.clear()
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
    sessionProfileRef.current = ''
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
    sessionId, sessionWorkspacePath, sessionCurrentDirectory, reasoningEffort, reasoningLoadFailed, reasoningBusy, chatUsage, sessionRef, sessionProfileRef, storedSessionRef,
    draft, setDraft, commandCatalog, commandCatalogError, activeChoice, setActiveChoice,
    draftCaret, setDraftCaret, draftInputRef, conversation, assistant, chatStatus, setChatStatus,
    turnBusy, canContinue, navigationBusy, sessionCreating, serverRequest, serverRequests, clarifyAnswers, setClarifyAnswer, sessions, sessionsState, attachments,
    attachmentBusy, draggingFiles, trigger, choices, argumentHint, answerRequest,
    changeReasoning, chooseCommand, chooseAttachments, pasteImages, removeAttachment, sendMessage,
    loadSessions, newChat, resumeSession, deleteSession, interruptSession, reconnectBackend, resetChat,
  }
}
