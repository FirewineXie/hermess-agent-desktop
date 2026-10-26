import React from 'react'
import { useLanguage, translateApp } from '../../i18n'
import ToolsetCard from './components/ToolsetCard'
import LocalToolCard from './components/LocalToolCard'
import { useToolsController } from './useToolsController'
import { mergeLocalTools } from './mergeLocalTools'

export default function ToolsView({ connected, sessionId }: { connected: boolean; sessionId: string }) {
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const {
    probes, error, loading, toolCatalog, activeTools, bundledTools, downloadableTools,
    toolCatalogError, activeToolsError, bundledToolsError, downloadableToolsError, toolLoading,
    toolSearch, setToolSearch, inspect, loadAgentTools, installTool, installingTool, installError, installedTool,
    activeToolDescriptions, searchTerm, visibleToolsets,
  } = useToolsController(connected, sessionId)
  const localTools = mergeLocalTools(bundledTools, downloadableTools, probes)

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
            <summary>{t('ui.local.tools')}<span>{localTools.length} {t('ui.items')}</span></summary>
            <div className="config-tree-children">
              <p>{t('ui.local.tools.hint')}</p>
              {bundledToolsError && <p role="alert">{t('ui.failed.to.load.bundled.tool.manifest')}{bundledToolsError}</p>}
              {downloadableToolsError && <p role="alert">{t('ui.optional.runtime.tools.catalog.failed')}{downloadableToolsError}</p>}
              {installError && <p role="alert">{t('ui.optional.runtime.tools.failed')}{installError}</p>}
              {installedTool && <p role="status">{t('ui.optional.runtime.tools.done', installedTool)}</p>}
              <button onClick={() => void inspect()} disabled={loading}>{loading ? t("ui.checking") : t("ui.check.again")}</button>
              {error && <p role="alert">{t("ui.check.failed")}{error}</p>}
              {localTools.map(row => <LocalToolCard key={row.key} row={row} installingTool={installingTool} installTool={installTool} t={t} />)}
            </div>
          </details>
        </div>
      </div>
    </section>
}
