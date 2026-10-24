import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { useLanguage, translateApp } from '../../i18n'

type RuntimeProbe = {
  tool: string
  kind: 'runtime' | 'command'
  path: string | null
  version: string | null
  usable: boolean
  reason: string
}
type BundledToolsInventory = { has_manifest: boolean; tools: Array<{ name: string; version: string; path: string; present: boolean }> }
type AgentToolset = { name: string; description: string; tool_count: number; enabled: boolean; tools?: string[] }
type AgentToolCatalog = { toolsets: AgentToolset[] }
type ActiveAgentTools = { sections: Array<{ name: string; tools: Array<{ name: string; description: string }> }>; total: number }

export default function ToolsView({ connected, sessionId }: { connected: boolean; sessionId: string }) {
  const { invoke } = useDesktop()
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
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

  async function inspect() {
    setLoading(true)
    setError('')
    try {
      setProbes(await invoke<RuntimeProbe[]>('probe_local_tools'))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setLoading(false)
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
    const params = { sessionId: id || null }
    const [catalog, active, bundled] = await Promise.allSettled([
      invoke<AgentToolCatalog>('list_agent_toolsets', params),
      invoke<ActiveAgentTools>('list_active_agent_tools', params),
      invoke<BundledToolsInventory>('list_bundled_tools'),
    ])
    if (request !== toolRequestRef.current) return
    if (catalog.status === 'fulfilled') setToolCatalog(catalog.value)
    else { setToolCatalog(null); setToolCatalogError(String(catalog.reason)) }
    if (active.status === 'fulfilled') setActiveTools(active.value)
    else { setActiveTools(null); setActiveToolsError(String(active.reason)) }
    if (bundled.status === 'fulfilled') setBundledTools(bundled.value)
    else { setBundledTools(null); setBundledToolsError(String(bundled.reason)) }
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
  }, [connected, sessionId])


  React.useEffect(() => { void inspect() }, [])
  const activeToolDescriptions = new Map(activeTools?.sections.flatMap(section => section.tools.map(tool => [tool.name, tool.description] as const)) || [])
  const searchTerm = toolSearch.trim().toLowerCase()
  const visibleToolsets = (toolCatalog?.toolsets || []).filter(group =>
    !searchTerm || [group.name, group.description, ...(group.tools || [])].some(value => value.toLowerCase().includes(searchTerm)))
  const visibleGroupTools = (group: AgentToolset) =>
    !searchTerm || [group.name, group.description].some(value => value.toLowerCase().includes(searchTerm))
      ? group.tools || [] : (group.tools || []).filter(name => name.toLowerCase().includes(searchTerm))

  return <section className="settings-panel flat-settings-panel tools-panel">
      <div className="row"><h2>{t("ui.tools.and.capabilities")}</h2><button disabled={!connected || toolLoading} onClick={() => void loadAgentTools(sessionId)}>{toolLoading ? t("ui.loading") : t("ui.refresh.tools")}</button></div>
      <p>{t("ui.directory.provided.by.the.current.hermes.runtime.expand.the.tool.group.to.v")}</p>
      {!connected && <p>{t("ui.after.starting.the.runtime.the.complete.tool.directory.is.read.including.te")}</p>}
      {connected && toolCatalogError && <p role="alert">{t("ui.failed.to.load.tool.catalog")}{toolCatalogError}</p>}
      {connected && activeToolsError && <p role="alert">{t("ui.failed.to.load.current.session.tool.state")}{activeToolsError}</p>}
      {connected && toolCatalog && <input className="tool-search" aria-label={t("ui.search.tools")} placeholder={t("ui.search.tool.groups.or.tools")} value={toolSearch} onChange={event => setToolSearch(event.target.value)} />}
      <div className="config-tree-root tools-tree">
        <div className="config-tree-root-heading">{t("ui.tools.and.capabilities")}</div>
        <div className="config-fields">
          <details className="config-tree-node" open={Boolean(searchTerm)}>
            <summary>{t("ui.agent.tools")}{toolCatalog && <span>{toolCatalog.toolsets.length} {t("ui.tool.groups")}{activeTools ? t("ui.arg.tools.available.in.this.session", activeTools.total) : t("ui.current.session.tool.state.is.unconfirmed")}</span>}</summary>
            <div className="config-tree-children">
              <div className="toolset-list">{visibleToolsets.map(group => <details className="config-tree-node" key={group.name} open={Boolean(searchTerm)}>
                <summary><strong>{group.name}</strong><span>{group.enabled ? t("ui.enabled") : t("ui.disabled")} · {group.tool_count} {t("ui.items")}</span></summary>
                <div className="config-tree-children">
                  {group.description && <p>{group.description}</p>}
                  {visibleGroupTools(group).map(name => {
                    const description = activeToolDescriptions.get(name)
                    const content = <><code>{name}</code>{activeTools && <span>{activeToolDescriptions.has(name) ? t("ui.available.in.this.session") : t("ui.unavailable.in.this.session")}</span>}</>
                    return description
                      ? <details className="tool-item" key={name}><summary>{content}</summary><p>{description}</p></details>
                      : <div className="tool-item tool-item-static" key={name}><div>{content}</div></div>
                  })}
                </div>
              </details>)}</div>
              {toolCatalog && visibleToolsets.length === 0 && <p>{t("ui.no.matching.tools")}</p>}
            </div>
          </details>
          <details className="config-tree-node">
            <summary>{t("ui.bundled.runtime.resources")}{bundledTools?.has_manifest && <span>{bundledTools.tools.length} {t("ui.items")}</span>}</summary>
            <div className="config-tree-children">
              <p>{t("ui.read.the.tool.list.of.the.current.startup.load.file.exists.only.confirms.th")}</p>
              {bundledToolsError && <p role="alert">{t("ui.failed.to.load.bundled.tool.manifest")}{bundledToolsError}</p>}
              {bundledTools && !bundledTools.has_manifest && <p>{t("ui.this.is.a.development.environment.or.there.is.no.payload.tool.list.that.can")}</p>}
              {bundledTools?.has_manifest && bundledTools.tools.map(tool => <details className="tool-item" key={tool.name}>
                <summary><strong>{tool.name}</strong><span>{tool.present ? t("ui.file.exists") : t("ui.file.missing")}</span></summary>
                <small>{t("ui.version")}{tool.version || t("ui.not.recorded")}</small><code>{tool.path}</code>
              </details>)}
            </div>
          </details>
          <details className="config-tree-node">
            <summary>{t("ui.system.path.tools")}{probes.length > 0 && <span>{probes.length} {t("ui.items")}</span>}</summary>
            <div className="config-tree-children">
              <p>{t("ui.detects.python.node.git.ffmpeg.ffprobe.ripgrep.uv.and.github.cli.in.path.py")}</p>
              <button onClick={() => void inspect()} disabled={loading}>{loading ? t("ui.checking") : t("ui.check.again")}</button>
              {error && <p role="alert">{t("ui.check.failed")}{error}</p>}
              {probes.map(probe => <details className="tool-item" key={probe.tool}>
                <summary><strong>{probe.tool}</strong><span>{probe.usable ? (probe.kind === 'command' ? t("ui.available") : t("ui.compatible.candidate")) : t("ui.not.available")}</span></summary>
                <small>{probe.version ?? probe.reason}</small>
                {probe.path && <code>{probe.path}</code>}
              </details>)}
            </div>
          </details>
        </div>
      </div>
    </section>
}
