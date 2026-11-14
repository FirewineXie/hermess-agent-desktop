import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import type { McpCatalogEntry, McpSetupDraft } from './model'
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
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  onConfigure: (profile: string, draft: McpSetupDraft) => Promise<boolean>
}

const key = (item: McpCatalogEntry) => item.identifier || `bundled:${item.name}`
const sourceLabel = (item: McpCatalogEntry, t: T) => item.source === 'modelscope'
  ? t('catalogModelScope') : item.identifier ? t('catalogRegistry') : t('catalogBundled')

export default function McpCatalog({ entries, results, resultsSource, profiles, busy, loading, t, search, installedTargets, runForProfiles, onMessage, request, onConfigure }: Props) {
  const [query, setQuery] = React.useState('')
  const [source, setSource] = React.useState('all')
  const [selected, setSelected] = React.useState<McpCatalogEntry | null>(null)
  const [targetStatus, setTargetStatus] = React.useState<TargetStatus>({ installed: [], unavailable: [] })
  const [openingId, setOpeningId] = React.useState('')
  const [env, setEnv] = React.useState<Record<string, string>>({})
  const [auth, setAuth] = React.useState('none')
  const [setup, setSetup] = React.useState<{ operation: string; item: McpCatalogEntry; detailFailed: boolean } | null>(null)
  const [setupIndex, setSetupIndex] = React.useState(0)
  const [setupError, setSetupError] = React.useState(false)
  const [navigating, setNavigating] = React.useState(false)
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
      const served = new Set(profiles.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]))
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

  async function openSetup(item: McpCatalogEntry) {
    if (!item.identifier || !profiles || openingId || busy) return
    const operation = crypto.randomUUID()
    setOpeningId(key(item))
    setSetupError(false)
    console.info('[mcp-setup] detail started', { operation })
    try {
      const detail = await request<McpCatalogEntry>('mcp.modelscope.preview', { identifier: item.identifier })
      const options = detail.setup_options || []
      const windows = navigator.userAgent.includes('Windows')
      setSetupIndex(windows ? Math.max(0, options.findIndex(option => option.transport === 'stdio' && /^cmd(?:\.exe)?$/i.test(option.command))) : 0)
      setSetup({ operation, item: detail, detailFailed: false })
      console.info('[mcp-setup] detail completed', { operation, options: options.length })
    } catch {
      setSetupIndex(0)
      setSetup({ operation, item, detailFailed: true })
      console.warn('[mcp-setup] detail failed', { operation })
    } finally { setOpeningId('') }
  }

  const documentation = setup && marketLink(setup.item.catalog_url, setup.item.repository)
  const setupOptions = setup?.item.setup_options || []
  async function continueSetup([profile]: string[]) {
    if (!setup || !profile || navigating) return
    setNavigating(true)
    setSetupError(false)
    try {
      const opened = await onConfigure(profile, {
        operation: setup.operation, name: setup.item.install_name || '', option: setupOptions[setupIndex], documentation: documentation || undefined,
      })
      if (opened) setSetup(null)
      else throw new Error('Target Profile unavailable')
    } catch {
      setSetupError(true)
      console.warn('[mcp-setup] navigation failed', { operation: setup.operation })
    } finally { setNavigating(false) }
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
      const manual = Boolean(item.identifier && !item.installable)
      const configurable = manual && item.source === 'modelscope'
      return <article className="extension-card market-card" key={key(item)}>
        <div className="market-card-header">
          <h3 className="market-card-title">{link ? <a href={link} target="_blank" rel="noopener noreferrer" title={link}>{item.name}</a> : item.name}</h3>
          <span className="market-card-source">{sourceLabel(item, t)}</span>
        </div>
        <p className="market-card-description">{item.description}</p>
        <div className="market-card-footer"><span className="market-card-meta">{t('transport')}: {configurable ? t('manualTransport') : item.transport}{item.version ? ` · v${item.version}` : ''}</span>
          <button type="button" disabled={busy || !!openingId || !profiles || (manual && !configurable)} onClick={() => void (configurable ? openSetup(item) : openInstall(item))}>{openingId === key(item) ? t('loading') : configurable ? t('configure') : t('install')}</button>
        </div>
        {manual && <small className="market-card-hint">{t(configurable ? 'catalogProfileSetup' : 'catalogManualShort')}</small>}
      </article>
    })}</div>
    {setup && profiles && <TargetProfilesDialog single itemName={setup.item.name} profiles={profiles} busy={navigating} onClose={() => setSetup(null)} onConfirm={continueSetup}>
      <div className="target-install-options">
        {setupOptions.length > 1 && <label>{t('catalogSetupOption')}<select value={setupIndex} onChange={event => setSetupIndex(Number(event.target.value))}>
          {setupOptions.map((option, index) => <option key={index} value={index}>{option.transport === 'http' ? option.url : [option.command, ...option.args].join(' ')}</option>)}
        </select></label>}
        {!setupOptions.length && <p>{t(setup.detailFailed ? 'catalogSetupUnavailable' : 'catalogSetupMissing')}</p>}
        {documentation && <a href={documentation} target="_blank" rel="noopener noreferrer">{t('catalogSetupDocs')}</a>}
        {setupError && <p role="alert">{t('failed')}</p>}
      </div>
    </TargetProfilesDialog>}
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
