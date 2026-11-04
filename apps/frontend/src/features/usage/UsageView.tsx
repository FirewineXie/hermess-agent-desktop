import type { UsageStatistics } from '@hermess/contracts'
import { useLanguage, translateApp } from '../../i18n'
import { useUsageStatistics } from './useUsageStatistics'
import UsageChart from './UsageChart'
import UsageBreakdown from './UsageBreakdown'

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

function ModelIdentity({ row, language, t }: {
  row: UsageStatistics['models'][number]
  language: string
  t: (key: string) => string
}) {
  const caps = row.capabilities
  return <div className="usage-model-identity">
    <strong>{row.model}</strong><small>{row.provider || t('ui.usage.unknown.provider')}</small>
    {caps && <div className="usage-model-capabilities">
      {caps.supports_tools && <span>{t('ui.usage.cap.tools')}</span>}
      {caps.supports_vision && <span>{t('ui.usage.cap.vision')}</span>}
      {caps.supports_reasoning && <span>{t('ui.usage.cap.reasoning')}</span>}
      {caps.model_family && <span>{caps.model_family}</span>}
      {Boolean(caps.context_window) && <span>{t('ui.usage.cap.context')} {amount(caps.context_window, language)}</span>}
      {Boolean(caps.max_output_tokens) && <span>{t('ui.usage.cap.output')} {amount(caps.max_output_tokens, language)}</span>}
    </div>}
  </div>
}

export default function UsageView({ connected, profile, epoch, onOpenConfiguration, onOpenModelSettings }: {
  connected: boolean; profile: string | null; epoch: string | null; onOpenConfiguration: () => void
  onOpenModelSettings: (page: 'main' | 'auxiliary') => void
}) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const { days, setDays, data, modelData, loading, failed, enabled, refresh } = useUsageStatistics(connected, profile, epoch)
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
    {connected && enabled === false && <div className="usage-hidden"><h3>{t('ui.usage.hidden.title')}</h3>
      <p>{t('ui.usage.hidden.explanation')}</p><p>{t('ui.usage.hidden.billing')}</p>
      <button type="button" onClick={onOpenConfiguration}>{t('ui.usage.hidden.configure')}</button>
    </div>}
    {connected && enabled === false && modelData && <div className="usage-section">
      <div className="usage-model-heading"><h3>{t('ui.usage.models')}</h3><div>
        <button type="button" onClick={() => onOpenModelSettings('main')}>{t('ui.usage.configure.main')}</button>
        <button type="button" onClick={() => onOpenModelSettings('auxiliary')}>{t('ui.usage.configure.auxiliary')}</button>
      </div></div>
      <p className="usage-note">{t('ui.usage.models.count.note')}</p>
      <div className="usage-metrics">
        <div className="usage-metric"><span>{t('ui.usage.models.count')}</span><strong>{amount(modelData.totals.distinct_models, language)}</strong></div>
        <div className="usage-metric"><span>{t('ui.usage.sessions')}</span><strong>{amount(modelData.totals.total_sessions, language)}</strong></div>
      </div>
      {modelData.models.length === 0 ? <p role="status">{t('ui.usage.models.empty')}</p>
        : <UsageBreakdown rows={modelData.models} initialSort="sessions" rowKey={row => `${row.provider}:${row.model}`} columns={[
          { key: 'model', label: t('ui.usage.model'), render: row => <ModelIdentity row={row} language={language} t={t} /> },
          { key: 'sessions', label: t('ui.usage.sessions'), render: row => amount(row.sessions, language) },
          { key: 'last_used_at', label: t('ui.usage.last.used'), render: row => row.last_used_at ? new Date(row.last_used_at * 1000).toLocaleString(language) : '—' },
        ]} />}
    </div>}
    {connected && enabled === true && data && <>
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
        <UsageBreakdown rows={data.daily} initialSort="day" rowKey={row => row.day} columns={[
          { key: 'day', label: t('ui.usage.date'), render: row => row.day },
          { key: 'sessions', label: t('ui.usage.sessions'), render: row => amount(row.sessions, language) },
          { key: 'input_tokens', label: t('ui.usage.input'), render: row => amount(row.input_tokens, language) },
          { key: 'output_tokens', label: t('ui.usage.output'), render: row => amount(row.output_tokens, language) },
          { key: 'reasoning_tokens', label: t('ui.usage.reasoning'), render: row => amount(row.reasoning_tokens, language) },
          { key: 'api_calls', label: t('ui.usage.calls'), render: row => amount(row.api_calls, language) },
          { key: 'estimated_cost', label: t('ui.usage.estimated.cost'), render: row => estimatedCost(row.estimated_cost, language) },
        ]} />
      </div>}
      {data.models.length > 0 && <div className="usage-section">
        <div className="usage-model-heading"><h3>{t('ui.usage.models')}</h3><div>
          <button type="button" onClick={() => onOpenModelSettings('main')}>{t('ui.usage.configure.main')}</button>
          <button type="button" onClick={() => onOpenModelSettings('auxiliary')}>{t('ui.usage.configure.auxiliary')}</button>
        </div></div>
        <UsageBreakdown rows={data.models} initialSort="input_tokens" rowKey={row => `${row.provider}:${row.model}`} columns={[
          { key: 'model', label: t('ui.usage.model'), render: row => <ModelIdentity row={row} language={language} t={t} /> },
          { key: 'sessions', label: t('ui.usage.sessions'), render: row => amount(row.sessions, language) },
          { key: 'last_used_at', label: t('ui.usage.last.used'), render: row => row.last_used_at ? new Date(row.last_used_at * 1000).toLocaleString(language) : '—' },
          { key: 'input_tokens', label: t('ui.usage.input'), render: row => amount(row.input_tokens, language) },
          { key: 'output_tokens', label: t('ui.usage.output'), render: row => amount(row.output_tokens, language) },
          { key: 'reasoning_tokens', label: t('ui.usage.reasoning'), render: row => amount(row.reasoning_tokens, language) },
          { key: 'cache_read_tokens', label: t('ui.usage.cache'), render: row => amount(row.cache_read_tokens, language) },
          { key: 'api_calls', label: t('ui.usage.calls'), render: row => amount(row.api_calls, language) },
          { key: 'tool_calls', label: t('ui.usage.tool.calls'), render: row => amount(row.tool_calls, language) },
          { key: 'avg_tokens_per_session', label: t('ui.usage.avg.per.session'), render: row => amount(row.avg_tokens_per_session, language) },
          { key: 'estimated_cost', label: t('ui.usage.estimated.cost'), render: row => estimatedCost(row.estimated_cost, language) },
        ]} />
      </div>}
      {data.skills.length > 0 && <div className="usage-section"><h3>{t('ui.usage.skills')}</h3>
        <UsageBreakdown rows={data.skills} initialSort="total_count" rowKey={row => row.skill} columns={[
          { key: 'skill', label: t('ui.usage.skill'), render: row => row.skill },
          { key: 'view_count', label: t('ui.usage.loads'), render: row => amount(row.view_count, language) },
          { key: 'manage_count', label: t('ui.usage.edits'), render: row => amount(row.manage_count, language) },
          { key: 'total_count', label: t('ui.usage.total'), render: row => amount(row.total_count, language) },
          { key: 'last_used_at', label: t('ui.usage.last.used'), render: row => row.last_used_at ? new Date(row.last_used_at * 1000).toLocaleString(language) : '—' },
        ]} />
      </div>}
      <p className="usage-note">{t('ui.usage.method')}</p>
    </>}
  </section>
}
