import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import type { HubScan, HubSkill } from './model'
import type { labels } from './labels'
import TargetProfilesDialog from './TargetProfilesDialog'
import { marketLink } from './marketLink'

type T = ReturnType<typeof labels>
type TargetStatus = { installed: string[]; unavailable: string[] }
type Props = {
  official: HubSkill[]; featured: HubSkill[]; sources: Array<{ id: string; label: string }>;
  results: HubSkill[] | null; resultsSource: string | null; busy: boolean; loading: boolean; t: T;
  profiles: ProfilesSnapshot | null;
  search: (query: string, source: string) => Promise<void>
  loadSources: () => Promise<void>
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  installedTargets: (kind: 'skill', targets: string[], identifier: string) => Promise<TargetStatus>
  runForProfiles: (operation: string, profiles: string[], payload: Record<string, unknown>, after: 'skillHub') => Promise<boolean>
  onMessage: (message: string) => void
}

export default function SkillHub({ official, featured, sources, results, resultsSource, profiles, busy, loading, t, search, loadSources, request, installedTargets, runForProfiles, onMessage }: Props) {
  const [query, setQuery] = React.useState('')
  const [source, setSource] = React.useState('official')
  const [selected, setSelected] = React.useState<HubSkill | null>(null)
  const [targetStatus, setTargetStatus] = React.useState<TargetStatus>({ installed: [], unavailable: [] })
  const [openingId, setOpeningId] = React.useState('')
  const [preparing, setPreparing] = React.useState(false)
  const initialEntries = [...official, ...featured.filter(item => !official.some(other => other.identifier === item.identifier))]
  const visibleResults = resultsSource === source ? results : null
  const entries = (visibleResults || (source === 'hermes-index' ? featured : initialEntries))
    .filter(item => source === 'all' || (source === 'hermes-index' ? item.source !== 'official' : item.source === source))

  function changeSource(nextSource: string) {
    setSource(nextSource)
    if (nextSource !== 'official' && !sources.length) void loadSources()
    void search(query, nextSource)
  }

  async function openInstall(item: HubSkill) {
    if (!profiles || openingId || busy) return
    setOpeningId(item.identifier)
    try {
      const served = new Set(profiles.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]))
      const names = profiles.profiles.map(profile => profile.name).filter(name => served.has(name))
      const status = await installedTargets('skill', names, item.identifier)
      setTargetStatus(status)
      setSelected(item)
    } catch {
      onMessage(t('failed'))
    } finally {
      setOpeningId('')
    }
  }

  async function installToTargets(targets: string[]) {
    if (!selected || preparing) return
    setPreparing(true)
    try {
      const isModelScope = selected.identifier.startsWith('modelscope:')
      let payload: Record<string, unknown> = { identifier: selected.identifier }
      if (isModelScope) {
        // The guarded installer requires a digest. Keep this check within the install action.
        const check = await request<HubScan>('skills.scan', payload)
        if (check.policy === 'block' || !check.digest) throw new Error(t('scanBlocked', check.policy_reason || check.summary || ''))
        payload = { ...payload, digest: check.digest, confirmed: true }
      }
      await runForProfiles(isModelScope ? 'modelscope.install' : 'skills.install', targets, payload, 'skillHub')
      setSelected(null)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : t('failed'))
      setSelected(null)
    } finally {
      setPreparing(false)
    }
  }

  return <>
    <p>{t('index')}</p>
    <form className="row extension-toolbar" onSubmit={event => { event.preventDefault(); if (source !== 'official' && !sources.length) void loadSources(); void search(query, source) }}>
      <input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label={t('source')} value={source} onChange={event => changeSource(event.target.value)}>
        <option value="official">{t('official')}</option>
        <option value="all">{t('sourceAll')}</option>
        {sources.filter(item => item.id !== 'official').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <button disabled={loading}>{t('search')}</button>
    </form>
    {!entries.length && <p>{loading ? t('loading') : visibleResults ? t('noResults') : !query.trim() && source !== 'all' && source !== 'official' ? t('sourceSearchHint') : t('empty')}</p>}
    <div className="extension-list">{entries.map(item => {
      const link = marketLink(item.repo)
      return <article className="extension-card market-card" key={item.identifier}>
        <div className="market-card-header">
          <h3 className="market-card-title">{link ? <a href={link} target="_blank" rel="noopener noreferrer" title={link}>{item.name}</a> : item.name}</h3>
          <span className="market-card-source">{item.source}</span>
        </div>
        <p className="market-card-description">{item.description}</p>
        <div className="market-card-footer"><button disabled={busy || !!openingId || !profiles} onClick={() => void openInstall(item)}>{openingId === item.identifier ? t('loading') : t('install')}</button></div>
      </article>
    })}</div>
    {selected && profiles && <TargetProfilesDialog itemName={selected.name} profiles={profiles} alreadyInstalled={targetStatus.installed} unavailable={targetStatus.unavailable} busy={busy || preparing} onClose={() => setSelected(null)} onConfirm={installToTargets} />}
  </>
}
