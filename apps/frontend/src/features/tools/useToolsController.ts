import React from 'react'
import type { RuntimeProbe, BundledToolsInventory, AgentToolCatalog, ActiveAgentTools, DownloadableTool } from '@hermess/contracts'
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
  const [downloadableTools, setDownloadableTools] = React.useState<DownloadableTool[]>([])
  const [downloadableToolsError, setDownloadableToolsError] = React.useState('')
  const [installingTool, setInstallingTool] = React.useState('')
  const [installError, setInstallError] = React.useState('')
  const [installedTool, setInstalledTool] = React.useState('')
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
    setDownloadableToolsError('')
    const [catalog, active, bundled, downloadable] = await Promise.allSettled([
      tools.listAgentToolsets(id || null),
      tools.listActiveAgentTools(id || null),
      tools.listBundledTools(),
      tools.listDownloadableTools(),
    ])
    if (request !== toolRequestRef.current) return
    if (catalog.status === 'fulfilled') setToolCatalog(catalog.value)
    else { setToolCatalog(null); setToolCatalogError(describeError(catalog.reason, language)) }
    if (active.status === 'fulfilled') setActiveTools(active.value)
    else { setActiveTools(null); setActiveToolsError(describeError(active.reason, language)) }
    if (bundled.status === 'fulfilled') setBundledTools(bundled.value)
    else { setBundledTools(null); setBundledToolsError(describeError(bundled.reason, language)) }
    if (downloadable.status === 'fulfilled') setDownloadableTools(downloadable.value)
    else { setDownloadableTools([]); setDownloadableToolsError(describeError(downloadable.reason, language)) }
    setToolLoading(false)
  }

  async function installTool(name: string) {
    if (installingTool) return
    setInstallingTool(name)
    setInstallError('')
    setDownloadableToolsError('')
    setInstalledTool('')
    try {
      await tools.installDownloadableTool(name)
      setInstalledTool(name)
      try {
        setDownloadableTools(await tools.listDownloadableTools())
      } catch (cause) {
        setDownloadableToolsError(describeError(cause, language))
      }
    } catch (cause) {
      setInstallError(describeError(cause, language))
    } finally {
      setInstallingTool('')
    }
  }

  React.useEffect(() => {
    if (connected) void loadAgentTools(sessionId)
    else {
      ++toolRequestRef.current
      setToolCatalog(null)
      setActiveTools(null)
      setBundledTools(null)
      setDownloadableTools([])
      setDownloadableToolsError('')
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
    probes, error, loading, toolCatalog, activeTools, bundledTools, downloadableTools,
    toolCatalogError, activeToolsError, bundledToolsError, downloadableToolsError, toolLoading,
    toolSearch, setToolSearch, inspect, loadAgentTools, installTool, installingTool, installError, installedTool,
    activeToolDescriptions, searchTerm, visibleToolsets,
  }
}
