import type { LocalToolRow } from '../mergeLocalTools'
import { displayPath } from '../../../shared/displayPath'

type Props = {
  row: LocalToolRow
  installingTool: string
  installTool: (name: string) => Promise<void>
  t: (key: string, ...values: unknown[]) => string
}

export default function LocalToolCard({ row, installingTool, installTool, t }: Props) {
  const { bundled, downloadable, system, companions } = row
  const status = bundled?.present ? t('ui.local.tools.bundled')
    : downloadable?.installed ? t('ui.optional.runtime.tools.installed')
    : system?.usable ? t('ui.local.tools.system.available')
    : downloadable && !downloadable.supported ? t('ui.optional.runtime.tools.unsupported')
    : downloadable?.supported ? t('ui.optional.runtime.tools.missing')
    : t('ui.not.available')

  return <details className="tool-item" key={row.key}>
    <summary><strong>{row.name}</strong><span>{status}</span></summary>
    {bundled && <><small>{t('ui.local.tools.bundled.detail', bundled.version || t('ui.not.recorded'), bundled.present ? t('ui.file.exists') : t('ui.file.missing'))}</small><code>{displayPath(bundled.path)}</code></>}
    {downloadable && <small>{t('ui.local.tools.pinned.detail', downloadable.version, downloadable.installed ? t('ui.optional.runtime.tools.installed') : downloadable.supported ? t('ui.optional.runtime.tools.missing') : t('ui.optional.runtime.tools.unsupported'))}</small>}
    {system && <><small>{t('ui.local.tools.system.detail', system.version || system.reason)}</small>{system.path && <code>{displayPath(system.path)}</code>}</>}
    {companions.map(probe => <div className="tool-item-companion" key={probe.tool}>
      <small>{t('ui.local.tools.companion.detail', probe.tool, probe.version || probe.reason)}</small>
      {probe.path && <code>{displayPath(probe.path)}</code>}
    </div>)}
    {downloadable?.supported && !downloadable.installed && !bundled?.present && <button type="button" disabled={Boolean(installingTool)} onClick={() => void installTool(downloadable.name)}>{installingTool === downloadable.name ? t('ui.optional.runtime.tools.installing') : t('ui.optional.runtime.tools.install')}</button>}
  </details>
}
