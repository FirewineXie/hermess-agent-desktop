import React from 'react'
import type { HubPreview, HubScan, HubSkill } from './model'
import type { labels } from './labels'

type T = ReturnType<typeof labels>
type Props = {
  official: HubSkill[]; featured: HubSkill[]; sources: Array<{ id: string; label: string }>;
  installed: Record<string, unknown>; results: HubSkill[] | null; resultsSource: string | null; busy: boolean; loading: boolean; t: T;
  search: (query: string, source: string) => Promise<void>
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  run: (operation: string, payload?: Record<string, unknown>, after?: 'skillHub') => Promise<boolean>
  onMessage: (message: string) => void
}

export default function SkillHub({ official, featured, sources, installed, results, resultsSource, busy, loading, t, search, request, run, onMessage }: Props) {
  const [query, setQuery] = React.useState('')
  const [source, setSource] = React.useState('all')
  const [selected, setSelected] = React.useState<HubPreview | null>(null)
  const [scan, setScan] = React.useState<HubScan | null>(null)
  const [openingId, setOpeningId] = React.useState('')
  const [detailError, setDetailError] = React.useState('')
  const [errorId, setErrorId] = React.useState('')
  const initialEntries = [...official, ...featured.filter(item => !official.some(other => other.identifier === item.identifier))]
  const visibleResults = resultsSource === source || (source !== 'hermes-index' && resultsSource === 'all') ? results : null
  const entries = (visibleResults || (source === 'hermes-index' ? featured : initialEntries))
    .filter(item => source === 'all' || (source === 'hermes-index' ? item.source !== 'official' : item.source === source))

  function changeSource(nextSource: string) {
    setSource(nextSource)
    setSelected(null); setScan(null); setErrorId('')
    void search(query, nextSource)
  }

  async function preview(item: HubSkill) {
    setOpeningId(item.identifier); setSelected(null); setScan(null); setDetailError(''); setErrorId('')
    try {
      const [detail, verdict] = await Promise.all([
        request<HubPreview>('skills.preview', { identifier: item.identifier }),
        request<HubScan>('skills.scan', { identifier: item.identifier }),
      ])
      if (detail.digest && detail.digest !== verdict.digest) throw new Error('ModelScope archive changed during preview')
      setSelected(detail); setScan(verdict)
    } catch { setErrorId(item.identifier); setDetailError(t('failed')); onMessage(t('failed')) }
    finally { setOpeningId('') }
  }

  async function install() {
    if (!selected || !scan) return
    if (scan.policy === 'block') { onMessage(t('scanBlocked', scan.policy_reason || scan.summary || '')); return }
    if (scan.policy === 'ask' && !window.confirm(t('scanAsk', scan.policy_reason || scan.summary || ''))) return
    const isModelScope = selected.source === 'modelscope'
    if (isModelScope && (!scan.digest || scan.digest !== selected.digest)) { onMessage(t('failed')); return }
    if (await run(isModelScope ? 'modelscope.install' : 'skills.install', {
      identifier: selected.identifier, ...(isModelScope ? { digest: scan.digest, confirmed: true } : {}),
    }, 'skillHub')) setSelected(null)
  }

  return <>
    <p>{t('index')}</p>
    <form className="row extension-toolbar" onSubmit={event => { event.preventDefault(); void search(query, source) }}>
      <input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label={t('source')} value={source} onChange={event => changeSource(event.target.value)}>
        <option value="all">{t('sourceAll')}</option>
        {sources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <button disabled={loading}>{t('search')}</button>
    </form>
    {!entries.length && <p>{visibleResults ? t('noResults') : !query.trim() && source !== 'all' ? t('sourceSearchHint') : t('empty')}</p>}
    <div className="extension-list">{entries.map(item => <article className="extension-card" key={item.identifier}>
      <div className="row"><strong>{item.name}</strong><small>{installed[item.identifier] || item.installed ? t('installed') : item.source}</small></div>
      <p>{item.description}</p>
      <small>{t('source')}: {item.source} · {item.identifier}</small>
      <div className="extension-actions"><button disabled={Boolean(openingId)} onClick={() => void preview(item)}>{t('preview')}</button></div>
      {openingId === item.identifier && <p role="status">{t('loading')}</p>}
      {errorId === item.identifier && detailError && <p role="alert">{detailError}</p>}
      {selected?.identifier === item.identifier && <section className="extension-detail">
        <div className="row"><h3>{selected.name}</h3><button onClick={() => setSelected(null)}>{t('close')}</button></div>
        <small>{t('source')}: {selected.source} · {selected.identifier}</small>
        <p>{t('scan')}: {scan?.policy || t('loading')} {scan?.summary}</p>
        <label>{t('content')}<pre className="extension-preview">{selected.skill_md || ''}</pre></label>
        <small>{t('files')}: {(selected.files || []).join(', ')}</small>
        <div className="extension-actions"><button disabled={busy || !scan || scan.policy === 'block' || Boolean(installed[selected.identifier])} onClick={() => void install()}>{t('install')}</button></div>
      </section>}
    </article>)}</div>
  </>
}
