import React from 'react'
import { useLanguage, translateApp } from '../../i18n'
import LocalToolCard from './components/LocalToolCard'
import { useToolsController } from './useToolsController'
import { mergeLocalTools } from './mergeLocalTools'

export default function ToolsView({ connected, epoch, generation }: { connected: boolean; epoch: string | null; generation: number }) {
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const {
    probes, probeError, loading, bundledTools, bundledToolsError,
    downloadableTools, downloadableToolsError, installingTool, installError, installedTool,
    refresh, installTool,
  } = useToolsController(connected, epoch, generation)
  const localTools = mergeLocalTools(bundledTools, downloadableTools, probes)

  return <section className="settings-panel flat-settings-panel tools-panel">
    <div className="row">
      <h2>{t('ui.tools.and.capabilities')}</h2>
      <button disabled={!connected || loading} onClick={() => void refresh()}>{loading ? t('ui.loading') : t('ui.refresh.tools')}</button>
    </div>
    <small className="tools-scope-note">{t('ui.local.tools.scope.hint')}</small>
    <div className="config-tree-root tools-tree">
      <div className="config-tree-root-heading">{t('ui.local.tools')} · {localTools.length} {t('ui.items')}</div>
      <div className="config-fields">
        <p>{t('ui.local.tools.hint')}</p>
        {bundledToolsError && <p role="alert">{t('ui.failed.to.load.bundled.tool.manifest')}{bundledToolsError}</p>}
        {downloadableToolsError && <p role="alert">{t('ui.optional.runtime.tools.catalog.failed')}{downloadableToolsError}</p>}
        {probeError && <p role="alert">{t('ui.check.failed')}{probeError}</p>}
        {installError && <p role="alert">{t('ui.optional.runtime.tools.failed')}{installError}</p>}
        {installedTool && <p role="status">{t('ui.optional.runtime.tools.done', installedTool)}</p>}
        {localTools.map(row => <LocalToolCard key={row.key} row={row} installingTool={installingTool} installTool={installTool} t={t} />)}
      </div>
    </div>
  </section>
}
