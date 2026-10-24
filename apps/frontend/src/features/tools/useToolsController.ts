import React from 'react'
import type { RuntimeProbe, BundledToolsInventory, AgentToolCatalog, ActiveAgentTools } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

export function useToolsController(connected: boolean, sessionId: string) {
  const { runtime, tools } = useDesktop()
  const language = useLanguage()
  const [probes, setProbes] = React.useState<RuntimeProbe[]>([])
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [toolCatalog, setToolCatalog] = React.useState<AgentToolCatalog | null>(null)
  const [activeTools, setActiveTools] = React.useState<ActiveAgentTools | null>(null)
  const [bundledTools, setBundledTools] = React.useState<BundledToolsInventory | null>(null)
  const [toolCatalogError, setToolCatalogError] = React.useState('')
  const [activeToolsError, setActiveToolsError] = React.useState('')
  const [bundledToolsError, setBundledToolsError] = React.useState('')
  const [toolLoading, setToolLoading] = React.useState(false)
  const [toolSearch, setToolSearch] = React.useState('')
  const toolRequestRef = React.useRef(0)
  const probeRequestRef = React.useRef(0)

  async function inspect() {
    const request = ++probeRequestRef.current
    setLoading(true)
    setError('')
    try {
      const result = await runtime.probeLocalTools()
      if (request === probeRequestRef.current) setProbes(result)
    } catch (cause) {
      if (request === probeRequestRef.current) setError(describeError(cause, language))
    } finally {
      if (request === probeRequestRef.current) setLoading(false)
    }
  }

  async function loadAgentTools(id: string) {
    const request = ++toolRequestRef.current
    setToolLoading(true)
    setToolCatalog(null)
    setActiveTools(null)
    setBundledTools(null)
    setToolCatalogError('')
    setActiveToolsError('')
    setBundledToolsError('')
    const [catalog, active, bundled] = await Promise.allSettled([
      tools.listAgentToolsets(id || null),
      tools.listActiveAgentTools(id || null),
      tools.listBundledTools(),
    ])
    if (request !== toolRequestRef.current) return
    if (catalog.status === 'fulfilled') setToolCatalog(catalog.value)
    else { setToolCatalog(null); setToolCatalogError(describeError(catalog.reason, language)) }
    if (active.status === 'fulfilled') setActiveTools(active.value)
    else { setActiveTools(null); setActiveToolsError(describeError(active.reason, language)) }
    if (bundled.status === 'fulfilled') setBundledTools(bundled.value)
    else { setBundledTools(null); setBundledToolsError(describeError(bundled.reason, language)) }
    setToolLoading(false)
  }

  React.useEffect(() => {
    if (connected) void loadAgentTools(sessionId)
    else {
      ++toolRequestRef.current
      setToolCatalog(null)
      setActiveTools(null)
      setBundledTools(null)
      setToolLoading(false)
    }
    return () => { ++toolRequestRef.current }
  }, [connected, sessionId])

  React.useEffect(() => {
    void inspect()
    return () => { ++probeRequestRef.current }
  }, [])
  const activeToolDescriptions = new Map(activeTools?.sections.flatMap(section => section.tools.map(tool => [tool.name, tool.description] as const)) || [])
  const searchTerm = toolSearch.trim().toLowerCase()
  const visibleToolsets = (toolCatalog?.toolsets || []).filter(group =>
    !searchTerm || [group.name, group.description, ...(group.tools || [])].some(value => value.toLowerCase().includes(searchTerm)))

  return {
    probes, error, loading, toolCatalog, activeTools, bundledTools,
    toolCatalogError, activeToolsError, bundledToolsError, toolLoading,
    toolSearch, setToolSearch, inspect, loadAgentTools,
    activeToolDescriptions, searchTerm, visibleToolsets,
  }
}
