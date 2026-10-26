import React from 'react'
import type { McpCatalogEntry, McpServer } from './model'
import type { labels } from './labels'

type T = ReturnType<typeof labels>
type Props = {
  entries: McpCatalogEntry[]; results: McpCatalogEntry[] | null; resultsSource: string | null;
  servers: McpServer[]; busy: boolean; loading: boolean; t: T;
  search: (query: string, source: string) => Promise<void>
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  run: (operation: string, payload?: Record<string, unknown>, after?: 'mcpCatalog') => Promise<boolean>
  onMessage: (message: string) => void
}

const key = (item: McpCatalogEntry) => item.identifier || `bundled:${item.name}`
const sourceLabel = (item: McpCatalogEntry, t: T) => item.source === 'modelscope'
  ? t('catalogModelScope') : item.identifier ? t('catalogRegistry') : item.source || t('catalogBundled')

export default function McpCatalog({ entries, results, resultsSource, servers, busy, loading, t, search, request, run, onMessage }: Props) {
  const [query, setQuery] = React.useState('')
  const [source, setSource] = React.useState('all')
  const [selected, setSelected] = React.useState<McpCatalogEntry | null>(null)
  const [openingId, setOpeningId] = React.useState('')
  const [errorId, setErrorId] = React.useState('')
  const [env, setEnv] = React.useState<Record<string, string>>({})
  const [auth, setAuth] = React.useState('none')
  React.useEffect(() => { void search('', 'all') }, [])
  const bundled = entries.filter(item => `${item.name} ${item.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const discovered = resultsSource === source ? results || [] : []
  const visible = source === 'bundled' ? bundled : source === 'all' ? [...bundled, ...discovered] : discovered
  const missing = selected?.required_env?.some(spec => spec.required && !env[spec.name]?.trim()) || false
  const isExternal = Boolean(selected?.identifier)
  const isModelScope = selected?.source === 'modelscope'
  const installed = selected && (selected.installed || (isExternal && servers.some(server => server.name === (selected.install_name || selected.identifier))))

  function changeSource(next: string) {
    setSource(next); setSelected(null); setEnv({}); setAuth('none'); setErrorId('')
    void search(query, next)
  }

  async function open(item: McpCatalogEntry) {
    setSelected(null); setEnv({}); setAuth('none'); setErrorId('')
    if (!item.identifier) { setSelected(item); return }
    setOpeningId(key(item))
    try {
      const detail = await request<McpCatalogEntry>(item.source === 'modelscope' ? 'mcp.modelscope.preview' : 'mcp.registry.preview',
        { identifier: item.identifier })
      setSelected(detail)
    } catch { setErrorId(key(item)); onMessage(t('failed')) }
    finally { setOpeningId('') }
  }

  async function install() {
    if (!selected) return
    const success = selected.identifier
      ? await run(isModelScope ? 'mcp.modelscope.install' : 'mcp.registry.install',
        { identifier: selected.identifier, version: selected.version, url: selected.url, auth }, 'mcpCatalog')
      : await run('mcp.install', { name: selected.name, env, enable: true }, 'mcpCatalog')
    if (success) { setSelected(null); setEnv({}) }
  }

  return <>
    <p>{t('catalog')}</p>
    <form className="row extension-toolbar" onSubmit={event => { event.preventDefault(); setSelected(null); void search(query, source) }}>
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
    <div className="extension-list">{visible.map(item => <article className="extension-card" key={key(item)}>
      <div className="row"><strong>{item.name}</strong><small>{item.installed || (item.identifier && servers.some(server => server.name === (item.install_name || item.identifier))) ? t('installed') : sourceLabel(item, t)}</small></div>
      <p>{item.description}</p>
      <small>{t('transport')}: {item.transport}{item.version ? ` · v${item.version}` : ''}</small>
      <div className="extension-actions"><button disabled={Boolean(openingId)} onClick={() => void open(item)}>{t('detail')}</button></div>
      {openingId === key(item) && <p role="status">{t('loading')}</p>}
      {errorId === key(item) && <p role="alert">{t('failed')}</p>}
      {selected && key(selected) === key(item) && <section className="extension-detail">
        <div className="row"><h3>{selected.name}</h3><button onClick={() => setSelected(null)}>{t('close')}</button></div>
        <p>{selected.description}</p>
        <small>{t('source')}: {sourceLabel(selected, t)} · {t('transport')}: {selected.transport}</small>
        {selected.identifier && <small>{selected.identifier}{selected.version ? ` · v${selected.version}` : ''}</small>}
        {selected.url || selected.command ? <code>{selected.url || [selected.command, ...(selected.args || [])].filter(Boolean).join(' ')}</code> : null}
        {!selected.url && selected.manual_url && <code>{selected.manual_url}</code>}
        {selected.package_hint && <code>{selected.package_hint}</code>}
        {selected.repository && <a href={selected.repository} target="_blank" rel="noopener noreferrer">{t('catalogRepository')}</a>}
        {selected.catalog_url && <a href={selected.catalog_url} target="_blank" rel="noopener noreferrer">{t('catalogOpenModelScope')}</a>}
        {selected.readme_excerpt && <label>{t('catalogReadme')}<pre className="extension-preview">{selected.readme_excerpt}</pre></label>}
        {!!selected.bootstrap?.length && <pre className="extension-preview">{selected.bootstrap.join('\n')}</pre>}
        {!!selected.required_env?.length && <><p>{t('noAuth')}</p>{selected.required_env.map(spec => <label key={spec.name}>
          {spec.prompt || spec.name}{spec.required ? ' *' : ''}<input type="password" autoComplete="off" value={env[spec.name] || ''}
            onChange={event => setEnv(value => ({ ...value, [spec.name]: event.target.value }))} />
        </label>)}</>}
        {isExternal && selected.installable && <label>{t('auth')}<select value={auth} onChange={event => setAuth(event.target.value)}>
          <option value="none">{t('authNone')}</option><option value="oauth">{t('authOAuth')}</option>
        </select></label>}
        {isExternal && <p>{selected.installable ? t('catalogRemoteHint') : isModelScope ? t('catalogModelScopeManualHint') : t('catalogManualHint')}</p>}
        <div className="extension-actions"><button disabled={busy || Boolean(installed) || missing || (isExternal && !selected.installable)} onClick={() => void install()}>{installed ? t('installed') : t('install')}</button></div>
      </section>}
    </article>)}</div>
  </>
}
