import React from 'react'
import { useLanguage, translateApp } from '../../i18n'
import ToolsetCard from './components/ToolsetCard'
import RuntimeProbeCard from './components/RuntimeProbeCard'
import { useToolsController } from './useToolsController'
import { displayPath } from '../../shared/displayPath'

export default function ToolsView({ connected, sessionId }: { connected: boolean; sessionId: string }) {
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const {
    probes, error, loading, toolCatalog, activeTools, bundledTools,
    toolCatalogError, activeToolsError, bundledToolsError, toolLoading,
    toolSearch, setToolSearch, inspect, loadAgentTools,
    activeToolDescriptions, searchTerm, visibleToolsets,
  } = useToolsController(connected, sessionId)

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
              <div className="toolset-list">{visibleToolsets.map(group => <ToolsetCard key={group.name} group={group} searchTerm={searchTerm} descriptions={activeToolDescriptions} hasActiveState={Boolean(activeTools)} t={t} />)}</div>
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
                <small>{t("ui.version")}{tool.version || t("ui.not.recorded")}</small><code>{displayPath(tool.path)}</code>
              </details>)}
            </div>
          </details>
          <details className="config-tree-node">
            <summary>{t("ui.system.path.tools")}{probes.length > 0 && <span>{probes.length} {t("ui.items")}</span>}</summary>
            <div className="config-tree-children">
              <p>{t("ui.detects.python.node.git.ffmpeg.ffprobe.ripgrep.uv.and.github.cli.in.path.py")}</p>
              <button onClick={() => void inspect()} disabled={loading}>{loading ? t("ui.checking") : t("ui.check.again")}</button>
              {error && <p role="alert">{t("ui.check.failed")}{error}</p>}
              {probes.map(probe => <RuntimeProbeCard key={probe.tool} probe={probe} t={t} />)}
            </div>
          </details>
        </div>
      </div>
    </section>
}
