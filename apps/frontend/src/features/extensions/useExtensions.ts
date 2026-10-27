import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileRef, useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { ActionStart, ActionStatus, ExtensionTab, HubSkill, LocalSkill, McpCatalogEntry, McpServer } from './model'

type HubSources = { sources: Array<{ id: string; label: string }>; featured: HubSkill[]; installed: Record<string, unknown> }
type ModelScopeInstalled = { identifiers: Record<string, boolean>; names: Record<string, string> }
type TargetKind = 'skill' | 'mcp'

export function useExtensions(connected: boolean, profile: string | null, epoch: string | null) {
  const { extensions } = useDesktop()
  const workspace = workspaceKey(epoch, profile)
  let stateSlot = 0
  const useState = <T,>(initial: T | (() => T)) => useProfileState(workspace, initial, `extensions:${stateSlot++}`)
  function scope() {
    if (!profile) throw new Error('No active Profile')
    return { kind: 'profile' as const, profile }
  }
  const language = useLanguage()
  const [tab, setTab] = useState<ExtensionTab>('skillHub')
  const [skills, setSkills] = useState<LocalSkill[]>([])
  const [servers, setServers] = useState<McpServer[]>([])
  const [official, setOfficial] = useState<HubSkill[]>([])
  const [featured, setFeatured] = useState<HubSkill[]>([])
  const [sources, setSources] = useState<HubSources['sources']>([])
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([])
  const [catalogResults, setCatalogResults] = useState<McpCatalogEntry[] | null>(null)
  const [catalogResultsSource, setCatalogResultsSource] = useState<string | null>(null)
  const [results, setResults] = useState<HubSkill[] | null>(null)
  const [resultsSource, setResultsSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [loadedTabs, setLoadedTabs] = useState<ExtensionTab[]>([])
  const alive = React.useRef(true)
  const refreshRequest = useProfileRef(workspace, 0)
  const searchRequest = useProfileRef(workspace, 0)
  const sourcesRequest = useProfileRef(workspace, 0)
  const catalogRequest = useProfileRef(workspace, 0)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  async function refresh(target: ExtensionTab = tab) {
    if (!connected || !profile) return false
    const requestId = ++refreshRequest.current
    const owner = scope()
    setLoadedTabs(current => current.filter(item => item !== target))
    setLoading(true)
    setMessage('')
    try {
      if (target === 'skills') {
        const [local, modelScope] = await Promise.all([
          extensions.request<LocalSkill[]>(owner, 'skills.list'),
          extensions.request<ModelScopeInstalled>(owner, 'modelscope.installed'),
        ])
        if (requestId !== refreshRequest.current || !alive.current) return false
        setSkills(local.map(skill => modelScope.names[skill.name]
          ? { ...skill, provenance: 'modelscope', sourceIdentifier: modelScope.names[skill.name] }
          : skill))
      }
      if (target === 'mcp') {
        const value = await extensions.request<{ servers: McpServer[] }>(owner, 'mcp.list')
        if (requestId !== refreshRequest.current || !alive.current) return false
        setServers(value.servers)
      }
      if (target === 'skillHub') {
        const officialResponse = await extensions.request<{ skills: HubSkill[] }>(owner, 'skills.official')
        if (requestId !== refreshRequest.current || !alive.current) return false
        setOfficial(officialResponse.skills)
      }
      if (target === 'mcpCatalog') {
        const [value, local] = await Promise.all([
          extensions.request<{ entries: McpCatalogEntry[] }>(owner, 'mcp.catalog'),
          extensions.request<{ servers: McpServer[] }>(owner, 'mcp.list'),
        ])
        if (requestId !== refreshRequest.current || !alive.current) return false
        setCatalog(value.entries)
        setServers(local.servers)
      }
      setLoadedTabs(current => current.includes(target) ? current : [...current, target])
      return true
    } catch (error) {
      if (requestId === refreshRequest.current && alive.current) setMessage(describeError(error, language))
      return false
    } finally {
      if (requestId === refreshRequest.current && alive.current) setLoading(false)
    }
  }

  React.useEffect(() => {
    if (loadedTabs.includes(tab)) setLoading(false)
    else void refresh(tab)
    return () => { ++refreshRequest.current }
  }, [tab, connected, profile, epoch])

  async function loadSources() {
    if (!connected || !profile) return
    const requestId = ++sourcesRequest.current
    try {
      const value = await extensions.request<HubSources>(scope(), 'skills.sources')
      if (requestId !== sourcesRequest.current || !alive.current) return
      setFeatured(value.featured)
      setSources(value.sources)
    } catch (error) {
      if (requestId === sourcesRequest.current && alive.current) setMessage(describeError(error, language))
    }
  }

  async function searchSkills(query: string, source: string) {
    const requestId = ++searchRequest.current
    if (source === 'official') {
      const term = query.trim().toLowerCase()
      setResults(term ? official.filter(item =>
        `${item.name} ${item.description || ''} ${item.identifier}`.toLowerCase().includes(term)) : null)
      setResultsSource(term ? source : null)
      setLoading(false)
      setMessage('')
      return
    }
    if (!query.trim() && source !== 'modelscope') { setResults(null); setResultsSource(null); setLoading(false); setMessage(''); return }
    setLoading(true)
    setMessage('')
    try {
      const value = await extensions.request<{ results: HubSkill[]; source_errors?: string[] }>(
        scope(), 'skills.search', { q: query.trim(), source })
      if (requestId !== searchRequest.current || !alive.current) return
      setResults(value.results)
      setResultsSource(source)
      if (value.source_errors?.includes('modelscope')) setMessage(language === 'zh-CN' ? 'ModelScope 搜索暂不可用；已显示其他来源结果。' : 'ModelScope search is unavailable; other results are shown.')
      if (value.source_errors?.includes('hermes')) setMessage(language === 'zh-CN' ? 'Hermes 来源搜索暂不可用；已显示 ModelScope 结果。' : 'Hermes source search is unavailable; ModelScope results are shown.')
    } catch (error) { if (requestId === searchRequest.current && alive.current) setMessage(describeError(error, language)) }
    finally { if (requestId === searchRequest.current && alive.current) setLoading(false) }
  }

  async function searchCatalog(query: string, source: string) {
    const requestId = ++catalogRequest.current
    if (source === 'bundled') {
      setCatalogResults(null); setCatalogResultsSource(null); setMessage(''); setLoading(false)
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const sources = source === 'all' ? ['registry', 'modelscope'] : [source]
      const responses = await Promise.allSettled(sources.map(item =>
        extensions.request<{ entries: McpCatalogEntry[] }>(scope(), `mcp.${item}.search`, { q: query.trim() })))
      if (requestId !== catalogRequest.current || !alive.current) return
      const successes = responses.filter((result): result is PromiseFulfilledResult<{ entries: McpCatalogEntry[] }> => result.status === 'fulfilled')
      if (!successes.length) throw (responses[0] as PromiseRejectedResult).reason
      setCatalogResults(successes.flatMap(result => result.value.entries))
      setCatalogResultsSource(source)
      if (successes.length !== responses.length) setMessage(language === 'zh-CN'
        ? '部分 MCP 来源暂不可用；已显示可用来源的结果。'
        : 'Some MCP sources are unavailable; results from available sources are shown.')
    } catch (error) {
      if (requestId !== catalogRequest.current || !alive.current) return
      setCatalogResults(null); setCatalogResultsSource(null)
      setMessage(describeError(error, language))
    } finally { if (requestId === catalogRequest.current && alive.current) setLoading(false) }
  }

  async function run(operation: string, payload: Record<string, unknown> = {}, after: ExtensionTab = tab) {
    setBusy(true)
    setMessage('')
    try {
      const owner = scope()
      const value = await extensions.request<ActionStart>(owner, operation, payload)
      const action = operation === 'skills.install' || operation === 'skills.uninstall' || operation === 'skills.update'
        ? value.name : value.background ? value.action : undefined
      if (action) {
        setMessage(language === 'zh-CN' ? '后台任务运行中…' : 'Background action running…')
        let done = false
        for (let attempt = 0; attempt < 120 && alive.current; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          const status = await extensions.request<ActionStatus>(owner, 'actions.status', { name: action })
          if (!status.running && status.exit_code !== null) {
            if (status.exit_code !== 0) throw new Error(language === 'zh-CN' ? '后台操作失败' : 'Background action failed')
            done = true
            break
          }
        }
        if (!done) throw new Error(language === 'zh-CN' ? '后台操作仍未完成，请稍后刷新列表' : 'Action is still running; refresh later')
      }
      if (alive.current) {
        const reloaded = await refresh(after)
        if (!reloaded) return false
        setMessage(language === 'zh-CN' ? '操作完成；新会话或重新加载后生效。' : 'Done; changes may need a new session or reload.')
      }
      return true
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error && !('kind' in error) ? error.message : describeError(error, language))
      return false
    } finally { if (alive.current) setBusy(false) }
  }

  async function runForProfiles(operation: string, profiles: string[], payload: Record<string, unknown>, after: 'skillHub' | 'mcpCatalog') {
    if (!profiles.length || !connected) return false
    setBusy(true)
    setMessage('')
    const failures: string[] = []
    let completed = 0
    try {
      for (const target of profiles) {
        const owner = { kind: 'profile' as const, profile: target }
        try {
          const value = await extensions.request<ActionStart>(owner, operation, payload)
          const action = operation === 'skills.install' ? value.name : value.background ? value.action : undefined
          if (action) {
            let done = false
            for (let attempt = 0; attempt < 120 && alive.current; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 1000))
              const status = await extensions.request<ActionStatus>(owner, 'actions.status', { name: action })
              if (!status.running && status.exit_code !== null) {
                if (status.exit_code !== 0) throw new Error('Background action failed')
                done = true
                break
              }
            }
            if (!done) throw new Error('Background action is still running')
          }
          completed += 1
        } catch {
          failures.push(target)
        }
      }
      await refresh(after)
      if (alive.current) setMessage(failures.length
        ? (language === 'zh-CN' ? `已添加到 ${completed} 个专家；以下专家失败或仍需检查：${failures.join('、')}` : `Added to ${completed} experts; check these failed or pending profiles: ${failures.join(', ')}`)
        : (language === 'zh-CN' ? `已添加到 ${completed} 个专家；请在新会话中确认生效。` : `Added to ${completed} experts. Check a new session for activation.`))
      return failures.length === 0
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function installedTargets(kind: TargetKind, targets: string[], identifier: string) {
    const results = await Promise.allSettled(targets.map(async target => {
      const owner = { kind: 'profile' as const, profile: target }
      if (kind === 'mcp') {
        const value = await extensions.request<{ servers: McpServer[] }>(owner, 'mcp.list')
        return value.servers.some(server => server.name === identifier)
      }
      if (identifier.startsWith('modelscope:')) {
        const value = await extensions.request<ModelScopeInstalled>(owner, 'modelscope.installed')
        return Boolean(value.identifiers[identifier])
      }
      if (identifier.startsWith('official/')) {
        const value = await extensions.request<{ skills: HubSkill[] }>(owner, 'skills.official')
        return Boolean(value.skills.find(skill => skill.identifier === identifier)?.installed)
      }
      const value = await extensions.request<HubSources>(owner, 'skills.sources')
      return Boolean(value.installed[identifier])
    }))
    return {
      installed: targets.filter((_, index) => results[index].status === 'fulfilled' && results[index].value),
      unavailable: targets.filter((_, index) => results[index].status === 'rejected'),
    }
  }

  function request<R>(operation: string, payload?: Record<string, unknown>): Promise<R> {
    return extensions.request<R>(scope(), operation, payload)
  }

  return { tab, setTab, skills, servers, official, featured, sources, catalog,
    catalogResults, catalogResultsSource, results, resultsSource,
    busy, loading, message, setMessage, loadSources, searchSkills, searchCatalog, run, runForProfiles, installedTargets, request }
}
