import { useLanguage, translateApp } from '../../i18n'
import { useUsageStatistics } from './useUsageStatistics'
import UsageChart from './UsageChart'

function amount(value: number | null | undefined, language: string): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(language)
    : '—'
}

function estimatedCost(value: number | null | undefined, language: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
  if (value < 0.00005) return '<$0.0001'
  return `≈$${value.toLocaleString(language, { minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2 })}`
}

export default function UsageView({ connected, profile, epoch }: { connected: boolean; profile: string | null; epoch: string | null }) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const { days, setDays, data, loading, failed, refresh } = useUsageStatistics(connected, profile, epoch)
  const totals = data?.totals
  const metrics = [
    ['ui.usage.input', totals?.total_input],
    ['ui.usage.output', totals?.total_output],
    ['ui.usage.reasoning', totals?.total_reasoning],
    ['ui.usage.cache', totals?.total_cache_read],
    ['ui.usage.calls', totals?.total_api_calls],
    ['ui.usage.sessions', totals?.total_sessions],
  ] as const

  return <section className="settings-panel flat-settings-panel usage-panel">
    <div className="usage-heading">
      <div><h2>{t('ui.usage.title')}</h2><p>{t('ui.usage.intro')}</p></div>
      <div className="usage-actions">
        <label>{t('ui.usage.period')}
          <select value={days} onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}>
            {[7, 30, 90].map(value => <option key={value} value={value}>{value} {t('ui.usage.days')}</option>)}
          </select>
        </label>
        <button type="button" disabled={!connected || loading} onClick={refresh}>{t('ui.usage.refresh')}</button>
      </div>
    </div>
    {!connected && <p role="status">{t('ui.usage.start')}</p>}
    {connected && loading && <p role="status">{t('ui.usage.loading')}</p>}
    {connected && failed && <p role="alert">{t('ui.usage.failed')}</p>}
    {connected && data && <>
      <div className="usage-metrics">
        {metrics.map(([label, value]) => <div className="usage-metric" key={label}>
          <span>{t(label)}</span><strong>{amount(value, language)}</strong>
        </div>)}
        <div className="usage-metric"><span>{t('ui.usage.estimated.cost')}</span>
          <strong>{estimatedCost(totals?.total_estimated_cost, language)}</strong></div>
      </div>
      <p className="usage-note">{t('ui.usage.reasoning.note')}</p>
      <p className="usage-note">{t('ui.usage.cost.note')}</p>
      {totals?.total_sessions === 0 && <p role="status">{t('ui.usage.empty')}</p>}
      {data.daily.length > 0 && <div className="usage-section">
        <h3>{t('ui.usage.trend')}</h3>
        <UsageChart daily={data.daily} days={days} language={language} />
        <h3 className="usage-daily-heading">{t('ui.usage.daily')}</h3>
        <div className="usage-table-scroll"><table><thead><tr>
          <th>{t('ui.usage.date')}</th><th>{t('ui.usage.input')}</th><th>{t('ui.usage.output')}</th>
          <th>{t('ui.usage.reasoning')}</th><th>{t('ui.usage.calls')}</th><th>{t('ui.usage.estimated.cost')}</th>
        </tr></thead><tbody>{[...data.daily].reverse().map(row => <tr key={row.day}>
          <td>{row.day}</td><td>{amount(row.input_tokens, language)}</td><td>{amount(row.output_tokens, language)}</td>
          <td>{amount(row.reasoning_tokens, language)}</td><td>{amount(row.api_calls, language)}</td>
          <td>{estimatedCost(row.estimated_cost, language)}</td>
        </tr>)}</tbody></table></div>
      </div>}
      {data.models.length > 0 && <div className="usage-section">
        <h3>{t('ui.usage.models')}</h3>
        <div className="usage-table-scroll"><table><thead><tr>
          <th>{t('ui.usage.model')}</th><th>{t('ui.usage.input')}</th><th>{t('ui.usage.output')}</th>
          <th>{t('ui.usage.reasoning')}</th><th>{t('ui.usage.cache')}</th><th>{t('ui.usage.calls')}</th>
          <th>{t('ui.usage.estimated.cost')}</th>
        </tr></thead><tbody>{data.models.map((row, index) => <tr key={`${row.provider}:${row.model}:${index}`}>
          <td><strong>{row.model}</strong><small>{row.provider || t('ui.usage.unknown.provider')}</small></td>
          <td>{amount(row.input_tokens, language)}</td><td>{amount(row.output_tokens, language)}</td>
          <td>{amount(row.reasoning_tokens, language)}</td><td>{amount(row.cache_read_tokens, language)}</td>
          <td>{amount(row.api_calls, language)}</td><td>{estimatedCost(row.estimated_cost, language)}</td>
        </tr>)}</tbody></table></div>
      </div>}
      <p className="usage-note">{t('ui.usage.method')}</p>
    </>}
  </section>
}
