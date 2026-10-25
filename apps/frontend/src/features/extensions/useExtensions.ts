import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { ActionStart, ActionStatus, ExtensionTab, HubSkill, LocalSkill, McpCatalogEntry, McpServer } from './model'

type HubSources = { sources: Array<{ id: string; label: string }>; featured: HubSkill[]; installed: Record<string, unknown> }

export function useExtensions(connected: boolean) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const [tab, setTab] = React.useState<ExtensionTab>('skills')
  const [skills, setSkills] = React.useState<LocalSkill[]>([])
  const [servers, setServers] = React.useState<McpServer[]>([])
  const [official, setOfficial] = React.useState<HubSkill[]>([])
  const [featured, setFeatured] = React.useState<HubSkill[]>([])
  const [sources, setSources] = React.useState<HubSources['sources']>([])
  const [installed, setInstalled] = React.useState<Record<string, unknown>>({})
  const [catalog, setCatalog] = React.useState<McpCatalogEntry[]>([])
  const [results, setResults] = React.useState<HubSkill[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const alive = React.useRef(true)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  async function refresh(target: ExtensionTab = tab) {
    if (!connected) return false
    setLoading(true)
    setMessage('')
    try {
      if (target === 'skills') setSkills(await extensions.request<LocalSkill[]>('skills.list'))
      if (target === 'mcp') {
        const value = await extensions.request<{ servers: McpServer[] }>('mcp.list')
        setServers(value.servers)
      }
      if (target === 'skillHub') {
        const [officialResponse, sourceResponse] = await Promise.all([
          extensions.request<{ skills: HubSkill[] }>('skills.official'),
          extensions.request<HubSources>('skills.sources'),
        ])
        setOfficial(officialResponse.skills)
        setFeatured(sourceResponse.featured)
        setSources(sourceResponse.sources)
        setInstalled(sourceResponse.installed)
      }
      if (target === 'mcpCatalog') {
        const value = await extensions.request<{ entries: McpCatalogEntry[] }>('mcp.catalog')
        setCatalog(value.entries)
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
    if (!query.trim()) { setResults(null); return }
    setLoading(true)
    setMessage('')
    try {
      const value = await extensions.request<{ results: HubSkill[]; installed: Record<string, unknown> }>(
        'skills.search', { q: query.trim(), source })
      setResults(value.results)
      setInstalled(value.installed)
    } catch (error) { setMessage(describeError(error, language)) }
    finally { if (alive.current) setLoading(false) }
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

  return { tab, setTab, skills, servers, official, featured, sources, installed, catalog, results,
    busy, loading, message, setMessage, refresh, searchSkills, run, request: extensions.request }
}
