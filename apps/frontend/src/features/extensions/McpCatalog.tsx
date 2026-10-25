import React from 'react'
import type { McpCatalogEntry } from './model'
import type { labels } from './labels'

type T = ReturnType<typeof labels>
type Props = {
  entries: McpCatalogEntry[]; busy: boolean; t: T;
  run: (operation: string, payload?: Record<string, unknown>, after?: 'mcpCatalog') => Promise<boolean>
}

export default function McpCatalog({ entries, busy, t, run }: Props) {
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<McpCatalogEntry | null>(null)
  const [env, setEnv] = React.useState<Record<string, string>>({})
  const visible = entries.filter(item => `${item.name} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase()))
  const missing = selected?.required_env?.some(spec => spec.required && !env[spec.name]?.trim()) || false

  async function install() {
    if (!selected) return
    const success = await run('mcp.install', { name: selected.name, env, enable: true }, 'mcpCatalog')
    if (success) { setSelected(null); setEnv({}) }
  }

  return <>
    <p>{t('catalog')}</p>
    <div className="extension-toolbar"><input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} /></div>
    {!visible.length && <p>{t('empty')}</p>}
    <div className="extension-list">{visible.map(item => <article className="extension-card" key={item.name}>
      <div className="row"><strong>{item.name}</strong><small>{item.installed ? t('installed') : item.source || 'Nous'}</small></div>
      <p>{item.description}</p>
      <small>{t('transport')}: {item.transport} · {t('auth')}: {item.auth_type || 'none'}</small>
      <div className="extension-actions"><button onClick={() => { setSelected(item); setEnv({}) }}>{t('detail')}</button></div>
      {selected?.name === item.name && <section className="extension-detail">
        <div className="row"><h3>{selected.name}</h3><button onClick={() => setSelected(null)}>{t('close')}</button></div>
        <p>{selected.description}</p>
        <small>{t('transport')}: {selected.transport} · {t('auth')}: {selected.auth_type || 'none'}</small>
        <code>{selected.url || [selected.command, ...(selected.args || [])].filter(Boolean).join(' ')}</code>
        {!!selected.bootstrap?.length && <pre className="extension-preview">{selected.bootstrap.join('\n')}</pre>}
        {!!selected.required_env?.length && <><p>{t('noAuth')}</p>{selected.required_env.map(spec => <label key={spec.name}>
          {spec.prompt || spec.name}{spec.required ? ' *' : ''}<input type="password" autoComplete="off" value={env[spec.name] || ''}
            onChange={event => setEnv(value => ({ ...value, [spec.name]: event.target.value }))} />
        </label>)}</>}
        <div className="extension-actions"><button disabled={busy || selected.installed || missing} onClick={() => void install()}>{selected.installed ? t('installed') : t('install')}</button></div>
      </section>}
    </article>)}</div>
  </>
}
