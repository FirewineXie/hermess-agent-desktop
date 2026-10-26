import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { ActionStart, ActionStatus, ExtensionTab, HubSkill, LocalSkill, McpCatalogEntry, McpServer } from './model'

type HubSources = { sources: Array<{ id: string; label: string }>; featured: HubSkill[]; installed: Record<string, unknown> }
type ModelScopeInstalled = { identifiers: Record<string, boolean>; names: Record<string, string> }

export function useExtensions(connected: boolean) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const [tab, setTab] = React.useState<ExtensionTab>('skillHub')
  const [skills, setSkills] = React.useState<LocalSkill[]>([])
  const [servers, setServers] = React.useState<McpServer[]>([])
  const [official, setOfficial] = React.useState<HubSkill[]>([])
  const [featured, setFeatured] = React.useState<HubSkill[]>([])
  const [sources, setSources] = React.useState<HubSources['sources']>([])
  const [installed, setInstalled] = React.useState<Record<string, unknown>>({})
  const [catalog, setCatalog] = React.useState<McpCatalogEntry[]>([])
  const [catalogResults, setCatalogResults] = React.useState<McpCatalogEntry[] | null>(null)
  const [catalogResultsSource, setCatalogResultsSource] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<HubSkill[] | null>(null)
  const [resultsSource, setResultsSource] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const alive = React.useRef(true)
  const searchRequest = React.useRef(0)
  const catalogRequest = React.useRef(0)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  async function refresh(target: ExtensionTab = tab) {
    if (!connected) return false
    setLoading(true)
    setMessage('')
    try {
      if (target === 'skills') {
        const [local, modelScope] = await Promise.all([
          extensions.request<LocalSkill[]>('skills.list'),
          extensions.request<ModelScopeInstalled>('modelscope.installed'),
        ])
        setSkills(local.map(skill => modelScope.names[skill.name]
          ? { ...skill, provenance: 'modelscope', sourceIdentifier: modelScope.names[skill.name] }
          : skill))
      }
      if (target === 'mcp') {
        const value = await extensions.request<{ servers: McpServer[] }>('mcp.list')
        setServers(value.servers)
      }
      if (target === 'skillHub') {
        const [officialResponse, sourceResponse, modelScope] = await Promise.all([
          extensions.request<{ skills: HubSkill[] }>('skills.official'),
          extensions.request<HubSources>('skills.sources'),
          extensions.request<ModelScopeInstalled>('modelscope.installed'),
        ])
        setOfficial(officialResponse.skills)
        setFeatured(sourceResponse.featured)
        setSources(sourceResponse.sources)
        setInstalled({ ...sourceResponse.installed, ...modelScope.identifiers })
      }
      if (target === 'mcpCatalog') {
        const [value, local] = await Promise.all([
          extensions.request<{ entries: McpCatalogEntry[] }>('mcp.catalog'),
          extensions.request<{ servers: McpServer[] }>('mcp.list'),
        ])
        setCatalog(value.entries)
        setServers(local.servers)
      }
      return true
    } catch (error) {
      setMessage(describeError(error, language))
      return false
    } finally {
      if (alive.current) setLoading(false)
    }
  }

  React.useEffect(() => { void refresh(tab) }, [tab, connected])

  async function searchSkills(query: string, source: string) {
    const requestId = ++searchRequest.current
    if (!query.trim() && source !== 'modelscope') { setResults(null); setResultsSource(null); setLoading(false); setMessage(''); return }
    setLoading(true)
    setMessage('')
    try {
      const value = await extensions.request<{ results: HubSkill[]; installed?: Record<string, unknown>; source_errors?: string[] }>(
        'skills.search', { q: query.trim(), source })
      if (requestId !== searchRequest.current || !alive.current) return
      setResults(value.results)
      setResultsSource(source)
      setInstalled(previous => ({ ...previous, ...value.installed }))
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
        extensions.request<{ entries: McpCatalogEntry[] }>(`mcp.${item}.search`, { q: query.trim() })))
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
      const value = await extensions.request<ActionStart>(operation, payload)
      const action = operation === 'skills.install' || operation === 'skills.uninstall' || operation === 'skills.update'
        ? value.name : value.background ? value.action : undefined
      if (action) {
        setMessage(language === 'zh-CN' ? '后台任务运行中…' : 'Background action running…')
        let done = false
        for (let attempt = 0; attempt < 120 && alive.current; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          const status = await extensions.request<ActionStatus>('actions.status', { name: action })
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

  return { tab, setTab, skills, servers, official, featured, sources, installed, catalog,
    catalogResults, catalogResultsSource, results, resultsSource,
    busy, loading, message, setMessage, refresh, searchSkills, searchCatalog, run, request: extensions.request }
}
