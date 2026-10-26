import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import type { McpCatalogEntry } from './model'
import type { labels } from './labels'
import TargetProfilesDialog from './TargetProfilesDialog'
import { marketLink } from './marketLink'

type T = ReturnType<typeof labels>
type TargetStatus = { installed: string[]; unavailable: string[] }
type Props = {
  entries: McpCatalogEntry[]; results: McpCatalogEntry[] | null; resultsSource: string | null;
  busy: boolean; loading: boolean; t: T; profiles: ProfilesSnapshot | null;
  search: (query: string, source: string) => Promise<void>
  installedTargets: (kind: 'mcp', targets: string[], identifier: string) => Promise<TargetStatus>
  runForProfiles: (operation: string, profiles: string[], payload: Record<string, unknown>, after: 'mcpCatalog') => Promise<boolean>
  onMessage: (message: string) => void
}

const key = (item: McpCatalogEntry) => item.identifier || `bundled:${item.name}`
const sourceLabel = (item: McpCatalogEntry, t: T) => item.source === 'modelscope'
  ? t('catalogModelScope') : item.identifier ? t('catalogRegistry') : t('catalogBundled')

export default function McpCatalog({ entries, results, resultsSource, profiles, busy, loading, t, search, installedTargets, runForProfiles, onMessage }: Props) {
  const [query, setQuery] = React.useState('')
  const [source, setSource] = React.useState('all')
  const [selected, setSelected] = React.useState<McpCatalogEntry | null>(null)
  const [targetStatus, setTargetStatus] = React.useState<TargetStatus>({ installed: [], unavailable: [] })
  const [openingId, setOpeningId] = React.useState('')
  const [env, setEnv] = React.useState<Record<string, string>>({})
  const [auth, setAuth] = React.useState('none')
  React.useEffect(() => { void search('', 'all') }, [])
  const bundled = entries.filter(item => `${item.name} ${item.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const discovered = resultsSource === source ? results || [] : []
  const visible = source === 'bundled' ? bundled : source === 'all' ? [...bundled, ...discovered] : discovered
  const missing = selected?.required_env?.some(spec => spec.required && !env[spec.name]?.trim()) || false

  function changeSource(next: string) {
    setSource(next)
    void search(query, next)
  }

  async function openInstall(item: McpCatalogEntry) {
    if (!profiles || openingId || busy || (item.identifier && !item.installable)) return
    setOpeningId(key(item))
    try {
      const served = new Set(profiles.gateways.flatMap(gateway => gateway.served_profiles || [gateway.profile]))
      const names = profiles.profiles.map(profile => profile.name).filter(name => served.has(name))
      const status = await installedTargets('mcp', names, item.install_name || item.identifier || item.name)
      setTargetStatus(status)
      setSelected(item)
      setEnv({})
      setAuth('none')
    } catch {
      onMessage(t('failed'))
    } finally {
      setOpeningId('')
    }
  }

  async function installToTargets(targets: string[]) {
    if (!selected) return
    const success = selected.identifier
      ? await runForProfiles(selected.source === 'modelscope' ? 'mcp.modelscope.install' : 'mcp.registry.install', targets,
        { identifier: selected.identifier, version: selected.version, url: selected.url, auth }, 'mcpCatalog')
      : await runForProfiles('mcp.install', targets, { name: selected.name, env, enable: true }, 'mcpCatalog')
    setSelected(null)
    if (success) setEnv({})
  }

  return <>
    <p>{t('catalog')}</p>
    <form className="row extension-toolbar" onSubmit={event => { event.preventDefault(); void search(query, source) }}>
      <input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label={t('source')} value={source} onChange={event => changeSource(event.target.value)}>
        <option value="all">{t('sourceAll')}</option>
        <option value="bundled">{t('catalogBundled')}</option>
        <option value="registry">{t('catalogRegistry')}</option>
        <option value="modelscope">{t('catalogModelScope')}</option>
      </select>
      <button disabled={loading}>{t('search')}</button>
    </form>
    {!visible.length && <p>{loading ? t('loading') : results && resultsSource === source ? t('noResults') : t('empty')}</p>}
    <div className="extension-list">{visible.map(item => {
      const link = marketLink(item.source, item.catalog_url, item.repository)
      return <article className="extension-card market-card" key={key(item)}>
        <div className="market-card-header">
          <h3 className="market-card-title">{link ? <a href={link} target="_blank" rel="noopener noreferrer" title={link}>{item.name}</a> : item.name}</h3>
          <span className="market-card-source">{sourceLabel(item, t)}</span>
        </div>
        <p className="market-card-description">{item.description}</p>
        <div className="market-card-footer"><span className="market-card-meta">{t('transport')}: {item.transport}{item.version ? ` · v${item.version}` : ''}</span>
          <button disabled={busy || !!openingId || !profiles || Boolean(item.identifier && !item.installable)} onClick={() => void openInstall(item)}>{openingId === key(item) ? t('loading') : t('install')}</button>
        </div>
        {item.identifier && !item.installable && <small className="market-card-hint">{t('catalogManualShort')}</small>}
      </article>
    })}</div>
    {selected && profiles && <TargetProfilesDialog itemName={selected.name} profiles={profiles} alreadyInstalled={targetStatus.installed} unavailable={targetStatus.unavailable} busy={busy} confirmDisabled={missing} onClose={() => setSelected(null)} onConfirm={installToTargets}>
      {!!selected.required_env?.length && <div className="target-install-options"><p>{t('required')}</p>{selected.required_env.map(spec => <label key={spec.name}>
        {spec.prompt || spec.name}{spec.required ? ' *' : ''}<input type="password" autoComplete="off" value={env[spec.name] || ''} onChange={event => setEnv(current => ({ ...current, [spec.name]: event.target.value }))} />
      </label>)}</div>}
      {!!selected.identifier && <div className="target-install-options"><label>{t('auth')}<select value={auth} onChange={event => setAuth(event.target.value)}>
        <option value="none">{t('authNone')}</option><option value="oauth">{t('authOAuth')}</option>
      </select></label></div>}
    </TargetProfilesDialog>}
  </>
}
