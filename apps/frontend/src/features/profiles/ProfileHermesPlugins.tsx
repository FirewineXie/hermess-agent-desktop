import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { HermesPluginRuntime, InstalledHermesPlugin } from '../extensions/HermesPlugins'
import snapshot from '../extensions/hermesPluginCatalog.generated.json'

export default function ProfileHermesPlugins({ profile, served, onOpenSources }: { profile: string | null; served: boolean; onOpenSources: () => void }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [data, setData] = React.useState<HermesPluginRuntime | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [removeConfirm, setRemoveConfirm] = React.useState('')
  const [updateConsent, setUpdateConsent] = React.useState<{ name: string; lines: string[] } | null>(null)

  const refresh = React.useCallback(async () => {
    if (!served || !profile) { setData(null); return }
    setLoading(true)
    setMessage('')
    try {
      setData(await extensions.request<HermesPluginRuntime>({ kind: 'profile', profile }, 'hermesPlugins.list'))
    } catch (error) {
      setData(null)
      setMessage(describeError(error, language))
    } finally { setLoading(false) }
  }, [served, profile, extensions, language])
  React.useEffect(() => { void refresh() }, [refresh])

  async function manage(operation: 'enable' | 'disable' | 'update' | 'remove', item: InstalledHermesPlugin, acceptCapabilities = false) {
    if (!served || !profile || busy || !data?.can_manage || !item.can_manage) return
    if (operation === 'remove' && removeConfirm !== item.name) { setRemoveConfirm(item.name); return }
    setRemoveConfirm('')
    setUpdateConsent(null)
    setBusy(item.name)
    setMessage('')
    try {
      const name = operation === 'update' ? item.catalog_name || item.name : item.name
      let result = await extensions.request<{ ok: boolean; consent_required?: boolean; scan_blocked?: boolean; delta_lines?: string[] }>(
        { kind: 'profile', profile }, `hermesPlugins.${operation}`, { name, ...(acceptCapabilities ? { accept_capabilities: true } : {}) })
      if (operation === 'update' && result.consent_required && !acceptCapabilities) {
        setUpdateConsent({ name: item.name, lines: result.delta_lines || [] })
        return
      }
      await refresh()
      setMessage(result.ok ? (zh ? '操作已返回，已重新读取安装状态；加载变化可能需要新会话。' : 'Action returned and installation state refreshed; loading changes may need a new session.')
        : (zh ? 'Agent 要求额外确认或阻止了操作，本页未继续。' : 'The Agent requires confirmation or blocked this action.'))
    } catch (error) { setMessage(describeError(error, language)) }
    finally { setBusy('') }
  }

  function status(item: InstalledHermesPlugin) {
    if (item.load_error) return zh ? '加载失败' : 'Load failed'
    if (item.loaded === true) return zh ? '已启用且已加载' : 'Enabled and loaded'
    if (item.runtime_status === 'enabled') return zh ? '已启用，加载状态未核实' : 'Enabled, load unverified'
    if (item.runtime_status === 'disabled') return zh ? '已停用' : 'Disabled'
    return zh ? '已安装，运行状态未核实' : 'Installed, runtime status unverified'
  }

  const visible = (data?.installed || []).filter(item => `${item.name} ${item.catalog_name || ''} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="profile-skills-panel profile-plugins-panel" aria-label={zh ? '此 Agent 已安装的 Hermes 插件' : 'Hermes plugins installed for this Agent'}>
    <div className="profile-skills-heading"><div><h3>{zh ? 'Hermes 插件' : 'Hermes plugins'}</h3><p>{data ? (zh ? `${data.installed.length} 个已安装插件` : `${data.installed.length} installed plugins`) : (zh ? '读取当前 Agent 的插件中…' : 'Loading this Agent’s plugins…')}</p></div>
      <button type="button" onClick={onOpenSources}>{zh ? '查看插件源列表' : 'View plugin sources'}</button>
      <button type="button" disabled={!served || loading || !!busy} onClick={() => void refresh()}>{loading ? '…' : zh ? '刷新' : 'Refresh'}</button></div>
    {!served && <p>{zh ? '当前 Agent 未由 Gateway 服务，无法核实插件。' : 'This Agent is not served by the Gateway.'}</p>}
    {data && !data.runtime_status_available && <p>{zh ? '加载状态暂不可用；已安装列表来自当前 Agent 的安装记录。' : 'Load status is unavailable; installations come from this Agent’s records.'}</p>}
    {message && <p role="status">{message}</p>}
    <label className="profile-skill-search"><span className="sr-only">{zh ? '搜索已安装插件' : 'Search installed plugins'}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '搜索已安装插件' : 'Search installed plugins'} /></label>
    {data && (visible.length ? <div className="extension-list">{visible.map(item => {
      const catalog = snapshot.entries.find(entry => entry.name === item.catalog_name)
      return <article className="extension-card" key={item.name}>
        <h4>{catalog?.title || item.name}</h4><p>{catalog?.description || item.description}</p>
        <p>{status(item)} · {catalog ? (zh ? 'Hermes 目录' : 'Hermes catalog') : (zh ? '目录外安装' : 'Outside catalog')}</p>
        {item.installed_sha && <code>{zh ? '已安装提交' : 'Installed commit'}: {item.installed_sha}</code>}
        {data.can_manage && item.can_manage && <div className="market-card-footer">
          <button disabled={!!busy || loading} onClick={() => void manage(item.runtime_status === 'enabled' ? 'disable' : 'enable', item)}>{item.runtime_status === 'enabled' ? zh ? '停用' : 'Disable' : zh ? '启用' : 'Enable'}</button>
          {catalog && <button disabled={!!busy || loading || item.installed_sha === catalog.sha} onClick={() => void manage('update', item)}>{zh ? '更新' : 'Update'}</button>}
          <button disabled={!!busy || loading} onClick={() => { setUpdateConsent(null); void manage('remove', item) }}>{zh ? '卸载' : 'Remove'}</button>
        </div>}
        {removeConfirm === item.name && <div role="group" aria-label={zh ? '确认卸载插件' : 'Confirm plugin removal'}>
          <p>{zh ? `确定卸载 ${item.name}？` : `Remove ${item.name}?`}</p>
          <button disabled={!!busy} onClick={() => void manage('remove', item)}>{zh ? '确认卸载' : 'Confirm removal'}</button>
          <button disabled={!!busy} onClick={() => setRemoveConfirm('')}>{zh ? '取消' : 'Cancel'}</button>
        </div>}
        {updateConsent?.name === item.name && <div role="group" aria-label={zh ? '确认插件新增能力' : 'Confirm new plugin capabilities'}>
          <p>{zh ? '更新会增加以下能力：' : 'The update adds these capabilities:'}</p>
          {updateConsent.lines.map(line => <p key={line}>{line}</p>)}
          <button disabled={!!busy} onClick={() => void manage('update', item, true)}>{zh ? '接受并更新' : 'Accept and update'}</button>
          <button disabled={!!busy} onClick={() => setUpdateConsent(null)}>{zh ? '取消' : 'Cancel'}</button>
        </div>}
      </article>
    })}</div> : <p>{query.trim() ? (zh ? '没有匹配的插件。' : 'No matching plugins.') : (zh ? '此 Agent 暂无已安装插件。' : 'No plugins installed for this Agent.')}</p>)}
  </section>
}
