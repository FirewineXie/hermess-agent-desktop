import React from 'react'
import type { CodingSession, CodingProject, CodingCatalog, CodingPermissionProfile, CodingCommand } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { programmingAttachmentText, readProgrammingImages, splitProgrammingPaths } from './programmingAttachments'

export function useProgrammingController(language: Language, workspace: string, active = true) {
  const { coding, nativeFiles } = useDesktop()
  const zh = language === 'zh-CN'
  const [catalog, setCatalog] = React.useState<CodingCatalog | null>(null)
  const catalogRef = React.useRef<CodingCatalog | null>(null)
  const [selectedModelId, setSelectedModelId] = React.useState('')
  const [projects, setProjects] = React.useState<CodingProject[]>([])
  const [draftProjectId, setDraftProjectId] = React.useState<string | undefined>()
  const [sessions, setSessions] = React.useState<CodingSession[]>([])
  const [session, setSession] = React.useState<CodingSession | null>(null)
  const [cwd, setCwd] = React.useState(workspace)
  React.useEffect(() => { if (workspace) setCwd(current => current || workspace) }, [workspace])
  const [draft, setDraft] = React.useState('')
  const [draftVisible, setDraftVisible] = React.useState(false)
  const [images, setImages] = React.useState<string[]>([])
  const [files, setFiles] = React.useState<string[]>([])
  const [draggingFiles, setDraggingFiles] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const generation = React.useRef(0)
  const operation = React.useRef(false)
  const [permissionProfiles, setPermissionProfiles] = React.useState<CodingPermissionProfile[]>([])
  const [permissions, setPermissions] = React.useState('request')
  const [selectedEffort, setEffort] = React.useState('')
  const effort = selectedEffort || session?.context?.effort || catalog?.effort || 'medium'
  const [permissionRuntimeMissing, setPermissionRuntimeMissing] = React.useState(false)
  const [permissionError, setPermissionError] = React.useState('')
  const [permissionLoading, setPermissionLoading] = React.useState(false)
  const [permissionRetry, retryPermissions] = React.useReducer(value => value + 1, 0)
  const permissionCwd = session?.cwd || cwd
  React.useEffect(() => {
    if (!active) return
    let current = true
    setPermissionLoading(true); setPermissionError(''); setPermissionProfiles([]); setPermissionRuntimeMissing(false)
    void (async () => {
      const runtime = await coding.runtime()
      if (!current) return
      if (runtime.state !== 'installed') { setPermissionRuntimeMissing(true); return }
      const rows = await coding.permissionProfiles(permissionCwd)
      if (current) setPermissionProfiles(rows)
    })()
      .catch(cause => { if (current) setPermissionError(describeError(cause, language)) })
      .finally(() => { if (current) setPermissionLoading(false) })
    return () => { current = false }
  }, [coding, permissionCwd, permissionRetry, language, active])
  const applyCatalog = React.useCallback((nextCatalog: CodingCatalog) => {
    catalogRef.current = nextCatalog; setCatalog(nextCatalog)
    setSelectedModelId(current => nextCatalog.providers.some(provider => provider.models.some(model => model.id === current)) ? current : nextCatalog.default_model)
  }, [])
  const refresh = React.useCallback(async () => {
    await Promise.all([
      coding.sessions().then(setSessions), coding.projects().then(setProjects), coding.catalog().then(applyCatalog),
    ])
  }, [coding, applyCatalog])
  React.useEffect(() => { void refresh().catch(cause => setError(describeError(cause, language))) }, [refresh, language])
  React.useEffect(() => {
    if (!session || session.status !== 'running') return
    let active = true
    let pending = false
    const poll = async () => {
      if (pending) return
      pending = true
      try {
        const value = await coding.read(session.id)
        if (active) { setSession(current => current?.id === value.id ? value : current); if (value.status !== 'running') await refresh() }
      } catch (cause) { if (active) setError(describeError(cause, language)) }
      finally { pending = false }
    }
    const timer = window.setInterval(() => void poll(), 500)
    return () => { active = false; clearInterval(timer) }
  }, [coding, session?.id, session?.status, refresh, language])
  const hasRunning = sessions.some(row => row.status === 'running')
  React.useEffect(() => {
    let active = true
    let pending = false
    const reload = async () => {
      if (pending) return
      pending = true
      try { const rows = await coding.sessions(); if (active) setSessions(rows) }
      catch (cause) { if (active) setError(describeError(cause, language)) }
      finally { pending = false }
    }
    window.addEventListener('focus', reload)
    const timer = hasRunning ? window.setInterval(() => void reload(), 2000) : undefined
    return () => { active = false; window.removeEventListener('focus', reload); clearInterval(timer) }
  }, [coding, language, hasRunning])
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true
    setBusy(true); setError('')
    try { await action() } catch (cause) { setError(describeError(cause, language)) }
    finally { operation.current = false; setBusy(false) }
  }
  const appendPaths = (paths: string[]) => {
    if (!active || session?.status === 'running') return
    const next = splitProgrammingPaths(paths)
    const addedImages = next.images.filter(path => !images.includes(path))
    if (images.length + addedImages.length > 4) throw new Error(zh ? '每次最多添加四张图片附件。' : 'Attach up to four images per turn.')
    setImages(current => [...new Set([...current, ...addedImages])])
    setFiles(current => [...new Set([...current, ...next.files])])
    console.info(`programming_attachments_added images=${addedImages.length} files=${next.files.length}`)
  }
  const addPaths = (paths: string[]) => run(async () => appendPaths(paths))
  const chooseAttachments = () => run(async () => {
    if (!active || session?.status === 'running') return
    const selected = await nativeFiles.choose({ directory: false, multiple: true, title: zh ? '选择图片或文件' : 'Choose images or files' })
    if (selected) appendPaths(Array.isArray(selected) ? selected : [selected])
  })
  const pasteImages = (pasted: File[]) => run(async () => {
    if (!active || session?.status === 'running' || !pasted.length) return
    const operationId = crypto.randomUUID()
    console.info(`programming_paste_start operation=${operationId} count=${pasted.length}`)
    try {
      const values = await readProgrammingImages(pasted, images, zh)
      setImages(current => [...current, ...values])
      console.info(`programming_paste_result operation=${operationId} success=true`)
    } catch (cause) {
      console.error(`programming_paste_result operation=${operationId} success=false`)
      throw cause
    }
  })
  React.useEffect(() => {
    if (!active) { setDraggingFiles(false); return }
    let current = true
    let unlisten: (() => void) | undefined
    void nativeFiles.onDrop(event => {
      if (!current) return
      if (event.type === 'leave' || event.type === 'drop') setDraggingFiles(false)
      if (operation.current || session?.status === 'running') return
      if (event.type === 'enter') setDraggingFiles(true)
      if (event.type === 'drop') void addPaths(event.paths)
    }).then(stop => { if (current) unlisten = stop; else stop() })
      .catch(cause => { if (current) setError(describeError(cause, language)) })
    return () => { current = false; unlisten?.() }
  }, [active, nativeFiles, session?.id, session?.status, images, language])
  const select = async (id: string) => {
    if (operation.current) return false
    let selected = false
    const current = ++generation.current
    await run(async () => {
      const value = await coding.read(id)
      if (generation.current === current) { setSession(value); setSelectedModelId(value.config_id); setPermissions(['request', 'auto', 'full', 'custom'].includes(value.context?.permissions || '') ? value.context!.permissions! : 'request'); setEffort(''); setDraft(''); setImages([]); setFiles([]); selected = true }
    })
    return selected
  }
  const newSession = (directory?: string, projectId?: string, modelId?: string) => {
    if (operation.current) return false
    setDraftVisible(true)
    ++generation.current; setSession(null); setDraft(''); setImages([]); setFiles([]); setError('')
    setPermissions('request')
    setEffort('')
    setSelectedModelId(modelId || catalogRef.current?.default_model || '')
    setDraftProjectId(projectId)
    if (directory) setCwd(directory)
    return true
  }
  const archive = async (id: string, archived: boolean) => {
    if (operation.current) return false
    let saved = false
    await run(async () => {
      const value = await coding.archive(id, archived)
      setSessions(rows => rows.map(row => row.id === id ? value : row))
      if (session?.id === id) {
        ++generation.current
        setSession(archived ? null : value)
        if (archived) setDraftVisible(Boolean(draft.trim() || images.length || files.length))
        setCwd(value.cwd); setDraftProjectId(value.project_id || undefined)
      }
      saved = true
    })
    return saved
  }
  const discardDraft = () => {
    if (operation.current || session) return
    ++generation.current
    setDraft(''); setImages([]); setFiles([]); setDraftVisible(false)
  }
  const remove = async (id: string) => {
    await run(async () => {
      await coding.remove(id)
      setSessions(rows => rows.filter(row => row.id !== id))
      if (session?.id === id) {
        ++generation.current
        setSession(null); setDraft(''); setImages([]); setFiles([]); setDraftVisible(false)
      }
    })
  }
  const saveProject = async (id: string | null, name: string, directory: string) => {
    const project = await coding.saveProject(id, name, directory)
    setProjects(current => current.some(row => row.id === project.id) ? current.map(row => row.id === project.id ? project : row) : [...current, project])
    if (!session && draftProjectId === project.id) setCwd(project.cwd)
    return project
  }
  const selectModel = (id: string) => {
    if (operation.current || session?.status === 'running' || id === (session?.config_id || selectedModelId)) return
    if (session) {
      const projectId = session.project_id || projects.find(project => project.legacy_cwds.includes(session.cwd))?.id
      const text = draft, attached = images, references = files
      newSession(session.cwd, projectId || undefined, id)
      setDraft(text); setImages(attached); setFiles(references)
    } else setSelectedModelId(id)
  }
  const send = () => run(async () => {
    if (!active || session?.status === 'running' || !draft.trim() && !images.length && !files.length) return
    const [runtime, config] = await Promise.all([coding.runtime(), coding.catalog()])
    applyCatalog(config)
    if (runtime.state !== 'installed') { setError(zh ? '请先在编程设置中下载运行时。' : 'Download the runtime in programming settings first.'); return }
    const modelId = session?.config_id || selectedModelId || config.default_model
    const provider = config.providers.find(provider => provider.models.some(model => model.id === modelId))
    if (!config.enabled || !provider?.has_key) { setError(zh ? '请先在编程设置中保存并启用模型连接。' : 'Save and enable the model connection in programming settings first.'); return }
    if (permissionLoading || !permissionProfiles.some(profile => profile.id === permissions && profile.allowed)) {
      setError(zh ? '请先成功读取并选择可用权限。' : 'Load and select an available permission profile first.'); return
    }
    const current = session || await coding.create(cwd, draftProjectId, modelId)
    setSession(current)
    await coding.send(current.id, programmingAttachmentText(draft, files), images, permissions, effort)
    setDraft(''); setImages([]); setFiles([])
    const running = { ...current, status: 'running' as const, error: '', output: '' }
    setSession(running)
    setSessions(rows => [running, ...rows.filter(row => row.id !== running.id)])
    setSession(await coding.read(current.id)); await refresh()
  })
  const executeCommand = async (command: CodingCommand) => {
    let success = false
    await run(async () => {
      if (!active) return
      if (!session && command.type !== 'plan' && !(command.type === 'goal' && command.action === 'set')) {
        throw new Error(zh ? '请先选择已有编程会话。' : 'Select an existing programming chat first.')
      }
      const current = session || await coding.create(cwd, draftProjectId, selectedModelId || catalogRef.current?.default_model)
      setSession(current)
      await coding.command(current.id, command, permissions, effort)
      const value = await coding.read(current.id)
      setSession(current => current?.id === value.id ? value : current)
      await refresh()
      success = true
    })
    return success
  }
  const answerQuestion = async (requestId: string, answers: Record<string, { answers: string[] }>) => {
    let success = false
    await run(async () => {
      if (!session || session.status !== 'running') return
      await coding.answer(session.id, requestId, answers)
      success = true
    })
    return success
  }
  return { coding, nativeFiles, catalog, applyCatalog, selectedModelId, selectModel, effort, setEffort, permissionRuntimeMissing, permissionProfiles, permissions, setPermissions, permissionLoading, permissionError, retryPermissions, projects, refresh, saveProject, draftProjectId, sessions, session, setSession, cwd, setCwd: (value: string) => { setCwd(value); setDraftProjectId(undefined) }, draft, setDraft, images, setImages, files, setFiles, draggingFiles, addPaths, chooseAttachments, pasteImages, busy, error, run, select, newSession, archive, remove, discardDraft, draftVisible, send, executeCommand, answerQuestion }
}
export type ProgrammingController = ReturnType<typeof useProgrammingController>
