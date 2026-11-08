import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { HermesPluginRuntime, InstalledHermesPlugin } from '../extensions/HermesPlugins'
import snapshot from '../extensions/hermesPluginCatalog.generated.json'

type PluginScanFinding = { severity: string; category: string; file: string; line: number | null; description: string }
type PluginMutationResult = {
  ok: boolean; unchanged?: boolean; consent_required?: boolean; scan_blocked?: boolean;
  scan_verdict?: string; scan_findings?: PluginScanFinding[]; delta_lines?: string[];
  plugin_name?: string; warnings?: string[]; missing_env?: string[]; enabled?: boolean; error?: string
}

type MemoryState = { active: string; providers: Array<{ name: string }> }

export default function ProfileHermesPlugins({ profile, served, onOpenSources, onOpenMemorySettings }: { profile: string | null; served: boolean; onOpenSources: () => void; onOpenMemorySettings: () => void }) {
  const { extensions, memory } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [data, setData] = React.useState<HermesPluginRuntime | null>(null)
  const [memoryState, setMemoryState] = React.useState<MemoryState | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [installId, setInstallId] = React.useState('')
  const [installForce, setInstallForce] = React.useState(false)
  const [installEnable, setInstallEnable] = React.useState(true)
  const [removeConfirm, setRemoveConfirm] = React.useState('')
  const [updateConsent, setUpdateConsent] = React.useState<{ name: string; lines: string[]; force: boolean } | null>(null)
  const [scanConsent, setScanConsent] = React.useState<{ item: InstalledHermesPlugin; verdict: string; findings: PluginScanFinding[]; acceptCapabilities: boolean } | null>(null)

  const refresh = React.useCallback(async () => {
    if (!served || !profile) { setData(null); setMemoryState(null); return }
    setLoading(true)
    setMessage('')
    try {
      const scope = { kind: 'profile' as const, profile }
      const [plugins, providers] = await Promise.allSettled([
        extensions.request<HermesPluginRuntime>(scope, 'hermesPlugins.list'),
        memory.providers(scope),
      ])
      if (plugins.status === 'rejected') throw plugins.reason
      setData(plugins.value)
      setMemoryState(providers.status === 'fulfilled' ? providers.value : null)
    } catch (error) {
      setData(null)
      setMemoryState(null)
      setMessage(describeError(error, language))
    } finally { setLoading(false) }
  }, [served, profile, extensions, memory, language])
  React.useEffect(() => { void refresh() }, [refresh])

  async function rescan() {
    if (!served || !profile || busy) return
    setBusy('__rescan__')
    setMessage('')
    try {
      const result = await extensions.request<{ ok: boolean; count: number }>(
        { kind: 'profile', profile }, 'hermesPlugins.rescan')
      await refresh()
      setMessage(result.ok
        ? (zh ? `重新扫描完成，发现 ${result.count} 个 Dashboard 扩展。` : `Rescan complete; found ${result.count} Dashboard extensions.`)
        : (zh ? '重新扫描未完成。' : 'Rescan did not complete.'))
    } catch (error) {
      setMessage(describeError(error, language))
    } finally {
      setBusy('')
    }
  }

  async function install(event: React.FormEvent) {
    event.preventDefault()
    const identifier = installId.trim()
    if (!served || !profile || busy || !data?.can_manage || !identifier) return
    setBusy('__install__')
    setMessage('')
    try {
      const result = await extensions.request<PluginMutationResult>(
        { kind: 'profile', profile }, 'hermesPlugins.install', {
          identifier, force: installForce, enable: installEnable,
        })
      if (!result.ok) throw new Error(result.error || (zh ? '插件安装未完成。' : 'Plugin installation did not complete.'))
      await refresh()
      setInstallId('')
      setInstallForce(false)
      const details = [
        ...(result.warnings || []),
        ...(result.missing_env?.length ? [zh ? `仍需配置：${result.missing_env.join(', ')}` : `Still required: ${result.missing_env.join(', ')}`] : []),
      ]
      setMessage(`${zh ? `已安装 ${result.plugin_name || identifier}` : `Installed ${result.plugin_name || identifier}`}${result.enabled ? (zh ? '，并已启用。' : ' and enabled.') : (zh ? '，当前未启用。' : ' and left disabled.')}${details.length ? ` ${details.join(' ')}` : ''}`)
    } catch (error) { setMessage(describeError(error, language)) }
    finally { setBusy('') }
  }

  async function manage(operation: 'enable' | 'disable' | 'update' | 'remove' | 'visibility', item: InstalledHermesPlugin, acceptCapabilities = false, force = false) {
    if (!served || !profile || busy || !data?.can_manage || !item.can_manage) return
    if (operation === 'remove' && removeConfirm !== item.name) { setRemoveConfirm(item.name); return }
    setRemoveConfirm('')
    setUpdateConsent(null)
    setScanConsent(null)
    setBusy(item.name)
    setMessage('')
    try {
      const result = await extensions.request<PluginMutationResult>(
        { kind: 'profile', profile }, `hermesPlugins.${operation}`, {
          name: item.name,
          ...(acceptCapabilities ? { accept_capabilities: true } : {}),
          ...(force ? { force: true } : {}),
          ...(operation === 'visibility' ? { hidden: !item.user_hidden } : {}),
        })
      if (operation === 'update' && result.consent_required && !acceptCapabilities) {
        setUpdateConsent({ name: item.name, lines: result.delta_lines || [], force })
        return
      }
      if (operation === 'update' && result.scan_blocked) {
        const findings = result.scan_findings || []
        if (result.scan_verdict === 'caution' && !force) {
          setScanConsent({ item, verdict: result.scan_verdict, findings, acceptCapabilities })
        } else {
          setMessage(zh
            ? `安全扫描阻止了更新（${result.scan_verdict || 'blocked'}），插件未变更。`
            : `The security scan blocked this update (${result.scan_verdict || 'blocked'}); the plugin was not changed.`)
        }
        return
      }
      await refresh()
      setMessage(result.ok ? (zh ? '操作完成并已重新读取插件状态；加载变化可能需要新会话。' : 'Action completed and plugin state refreshed; loading changes may need a new session.')
        : (zh ? 'Agent 要求额外确认或阻止了操作，本页未继续。' : 'The Agent requires confirmation or blocked this action.'))
    } catch (error) { setMessage(describeError(error, language)) }
    finally { setBusy('') }
  }

  function status(item: InstalledHermesPlugin, isMemoryProvider: boolean) {
    if (busy === item.name) return zh ? '正在处理插件…' : 'Updating plugin…'
    if (isMemoryProvider) {
      if (!memoryState) return zh ? '已安装，记忆提供方状态暂不可用' : 'Installed, memory provider status unavailable'
      const active = memoryState?.active === item.catalog_name || memoryState?.active === item.name
      if (!active) return zh ? '已安装，未选为当前记忆提供方' : 'Installed, not the active memory provider'
      return item.load_error ? (zh ? '当前记忆提供方，加载失败' : 'Active memory provider, load failed')
        : (zh ? '当前记忆提供方' : 'Active memory provider')
    }
    if (item.load_error) return zh ? '加载失败' : 'Load failed'
    if (item.loaded === true) return zh ? '已启用且已加载' : 'Enabled and loaded'
    if (item.runtime_status === 'enabled') return zh ? '已启用，加载状态未核实' : 'Enabled, load unverified'
    if (item.runtime_status === 'disabled') return zh ? '已停用' : 'Disabled'
    return zh ? '已安装，运行状态未核实' : 'Installed, runtime status unverified'
  }

  const visible = (data?.installed || []).filter(item => `${item.name} ${item.catalog_name || ''} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="profile-skills-panel profile-plugins-panel" aria-label={zh ? '此 Profile 已安装的 Hermes 插件' : 'Hermes plugins installed for this Profile'}>
    <div className="profile-skills-heading"><div><h3>{zh ? 'Hermes 插件' : 'Hermes plugins'}</h3><p>{data ? (zh ? `${data.installed.length} 个已安装插件` : `${data.installed.length} installed plugins`) : (zh ? '读取当前 Profile 的插件中…' : 'Loading this Profile’s plugins…')}</p></div>
      <button type="button" onClick={onOpenSources}>{zh ? '查看插件源列表' : 'View plugin sources'}</button>
      <button type="button" disabled={!served || loading || !!busy} onClick={() => void rescan()}>{busy === '__rescan__' ? '…' : zh ? '重新扫描' : 'Rescan'}</button>
      <button type="button" disabled={!served || loading || !!busy} onClick={() => void refresh()}>{loading ? '…' : zh ? '刷新' : 'Refresh'}</button></div>
    {!served && <p>{zh ? '当前 Profile 未由 Gateway 服务，无法核实插件。' : 'This Profile is not served by the Gateway.'}</p>}
    {data && !data.runtime_status_available && <p>{zh ? '加载状态暂不可用；已安装列表来自当前 Profile 的安装记录。' : 'Load status is unavailable; installations come from this Profile’s records.'}</p>}
    {message && <p role="status">{message}</p>}
    <form className="profile-plugin-install" onSubmit={event => void install(event)}>
      <div><strong>{zh ? '从其他来源安装' : 'Install from another source'}</strong><p>{zh ? '支持 owner/repo、owner/repo/子目录或 HTTPS 地址。此入口属于当前 Profile 的本地管理。' : 'Supports owner/repo, owner/repo/subdirectory, or an HTTPS URL. This is local management for the current Profile.'}</p></div>
      <label><span>{zh ? '插件标识' : 'Plugin identifier'}</span><input value={installId} disabled={!served || !!busy} spellCheck={false} placeholder="owner/repo or https://…" onChange={event => setInstallId(event.target.value)} /></label>
      <label><input type="checkbox" checked={installForce} disabled={!served || !!busy} onChange={event => setInstallForce(event.target.checked)} />{zh ? '强制重新安装' : 'Force reinstall'}</label>
      <label><input type="checkbox" checked={installEnable} disabled={!served || !!busy} onChange={event => setInstallEnable(event.target.checked)} />{zh ? '安装后启用' : 'Enable after install'}</label>
      <button type="submit" disabled={!served || !!busy || !data?.can_manage || !installId.trim()}>{busy === '__install__' ? (zh ? '安装中…' : 'Installing…') : (zh ? '安装插件' : 'Install plugin')}</button>
    </form>
    <label className="profile-skill-search"><span className="sr-only">{zh ? '搜索已安装插件' : 'Search installed plugins'}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '搜索已安装插件' : 'Search installed plugins'} /></label>
    {data && (visible.length ? <div className="extension-list">{visible.map(item => {
      const catalog = snapshot.entries.find(entry => entry.name === item.catalog_name)
      const isMemoryProvider = memoryState?.providers.some(provider => provider.name === item.catalog_name || provider.name === item.name)
        || (!memoryState && catalog?.category === 'memory')
      return <article className="extension-card" key={item.name}>
        <h4>{catalog?.title || item.name}</h4><p>{catalog?.description || item.description}</p>
        <p>{status(item, isMemoryProvider)} · {catalog ? (zh ? 'Hermes 目录' : 'Hermes catalog') : item.source === 'bundled' ? (zh ? '随 Hermes 提供' : 'Bundled with Hermes') : (zh ? '目录外安装' : 'Outside catalog')}</p>
        {isMemoryProvider && <p>{zh ? '记忆提供方须在「设置 → 持久记忆」中配置并选择；普通插件开关不能激活它。' : 'Configure and select memory providers in Settings → Persistent memory; the plugin toggle cannot activate them.'}</p>}
        {item.auth_required && <p>{zh ? '需要先完成此插件的认证配置。' : 'Authentication must be configured before this plugin can run.'}</p>}
        {item.removed_reason && <p>{zh ? '已从目录移除：' : 'Removed from catalog: '}{item.removed_reason}</p>}
        {item.installed_sha && <code>{zh ? '已安装提交' : 'Installed commit'}: {item.installed_sha}</code>}
        {item.has_dashboard_manifest && <div className="profile-plugin-dashboard-meta">
          <p>{zh ? 'Dashboard 扩展' : 'Dashboard extension'}{item.dashboard_label ? ` · ${item.dashboard_label}` : ''}{item.dashboard_path ? ` · ${item.dashboard_path}` : ''}</p>
          {!!item.dashboard_slots.length && <p>{zh ? '插槽：' : 'Slots: '}{item.dashboard_slots.join(', ')}</p>}
        </div>}
        {data.can_manage && item.can_manage && <div className="market-card-footer">
          {isMemoryProvider && <button type="button" disabled={!!busy || loading} onClick={onOpenMemorySettings}>{zh ? '配置记忆提供方' : 'Configure memory provider'}</button>}
          {item.can_toggle && !isMemoryProvider && <button disabled={!!busy || loading} onClick={() => void manage(item.runtime_status === 'enabled' ? 'disable' : 'enable', item)}>{item.runtime_status === 'enabled' ? zh ? '停用' : 'Disable' : zh ? '启用' : 'Enable'}</button>}
          {item.can_update_git && <button disabled={!!busy || loading || (!!catalog && item.installed_sha === catalog.sha)} onClick={() => void manage('update', item)}>{zh ? '更新' : 'Update'}</button>}
          {item.has_dashboard_manifest && <button disabled={!!busy || loading} onClick={() => void manage('visibility', item)}>{item.user_hidden ? (zh ? '在 Dashboard 显示' : 'Show in Dashboard') : (zh ? '从 Dashboard 隐藏' : 'Hide from Dashboard')}</button>}
          {item.can_remove && <button disabled={!!busy || loading} onClick={() => { setUpdateConsent(null); setScanConsent(null); void manage('remove', item) }}>{zh ? '卸载' : 'Remove'}</button>}
        </div>}
        {removeConfirm === item.name && <div role="group" aria-label={zh ? '确认卸载插件' : 'Confirm plugin removal'}>
          <p>{zh ? `确定卸载 ${item.name}？` : `Remove ${item.name}?`}</p>
          <button disabled={!!busy} onClick={() => void manage('remove', item)}>{zh ? '确认卸载' : 'Confirm removal'}</button>
          <button disabled={!!busy} onClick={() => setRemoveConfirm('')}>{zh ? '取消' : 'Cancel'}</button>
        </div>}
        {updateConsent?.name === item.name && <div role="group" aria-label={zh ? '确认插件新增能力' : 'Confirm new plugin capabilities'}>
          <p>{zh ? '更新会增加以下能力：' : 'The update adds these capabilities:'}</p>
          {updateConsent.lines.map(line => <p key={line}>{line}</p>)}
          <button disabled={!!busy} onClick={() => void manage('update', item, true, updateConsent.force)}>{zh ? '接受并更新' : 'Accept and update'}</button>
          <button disabled={!!busy} onClick={() => setUpdateConsent(null)}>{zh ? '取消' : 'Cancel'}</button>
        </div>}
        {scanConsent?.item.name === item.name && <div role="group" className="profile-plugin-scan" aria-label={zh ? '确认插件安全扫描风险' : 'Confirm plugin scan risk'}>
          <p>{zh ? '更新代码触发安全扫描警告。只有确认接受下列风险后才会继续：' : 'The updated code triggered security scan warnings. Continue only after reviewing these findings:'}</p>
          {scanConsent.findings.length ? <ul>{scanConsent.findings.map((finding, index) => <li key={`${finding.file}:${finding.line || 0}:${index}`}>
            <strong>{finding.severity} · {finding.category}</strong> — <code>{finding.file}{finding.line ? `:${finding.line}` : ''}</code><br />{finding.description}
          </li>)}</ul> : <p>{zh ? '扫描器没有返回可展示的明细。' : 'The scanner returned no displayable findings.'}</p>}
          <button disabled={!!busy || scanConsent.verdict !== 'caution'} onClick={() => void manage('update', item, scanConsent.acceptCapabilities, true)}>{zh ? '接受警告并更新' : 'Accept warning and update'}</button>
          <button disabled={!!busy} onClick={() => setScanConsent(null)}>{zh ? '取消' : 'Cancel'}</button>
        </div>}
      </article>
    })}</div> : <p>{query.trim() ? (zh ? '没有匹配的插件。' : 'No matching plugins.') : (zh ? '此 Profile 暂无已安装插件。' : 'No plugins installed for this Profile.')}</p>)}
    {!!data?.orphan_dashboard_plugins.length && <section className="profile-plugin-orphans">
      <h4>{zh ? '仅 Dashboard 扩展' : 'Dashboard-only extensions'}</h4>
      <p>{zh ? '以下扩展没有对应的 Agent plugin.yaml，只提供 Dashboard 界面能力。' : 'These extensions have no matching Agent plugin.yaml and provide Dashboard UI only.'}</p>
      <ul>{data.orphan_dashboard_plugins.map(item => <li key={item.name}><strong>{item.label || item.name}</strong>{item.version ? ` · ${item.version}` : ''}{item.path ? ` · ${item.path}` : ''}{item.description ? <p>{item.description}</p> : null}</li>)}</ul>
    </section>}
  </section>
}
