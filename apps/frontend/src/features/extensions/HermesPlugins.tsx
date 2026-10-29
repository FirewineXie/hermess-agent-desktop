import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import snapshot from './hermesPluginCatalog.generated.json'
import { marketLink } from './marketLink'
import TargetProfilesDialog from './TargetProfilesDialog'

export type InstalledHermesPlugin = {
  name: string; version: string; description: string; source: string; runtime_status: string;
  loaded: boolean | null; load_error: boolean;
  catalog_name: string | null; installed_sha: string | null; can_manage: boolean; removed_reason: string
}
export type HermesPluginRuntime = { installed: InstalledHermesPlugin[]; can_manage: boolean; runtime_status_available: boolean }
type CatalogItem = (typeof snapshot.entries)[number]
type TargetStatus = { installed: string[]; unavailable: string[] }
const pluginSearchAliases: Record<string, string> = {
  'hermes-session-reset-policy': '会话 自动新对话 自动新会话 空闲 长时间不用 每日重置 微信 飞书 session reset idle daily',
}

export default function HermesPlugins({ connected, profiles }: { connected: boolean; profiles: ProfilesSnapshot | null }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [query, setQuery] = React.useState('')
  const [searchTerm, setSearchTerm] = React.useState('')
  const [limit, setLimit] = React.useState(40)
  const [selected, setSelected] = React.useState<CatalogItem | null>(null)
  const [targetStatus, setTargetStatus] = React.useState<TargetStatus>({ installed: [], unavailable: [] })
  const [opening, setOpening] = React.useState('')
  const [installing, setInstalling] = React.useState(false)
  const [message, setMessage] = React.useState('')

  const removed = new Map(snapshot.removed.map(item => [item.name, item.reason]))
  const os = navigator.userAgent.includes('Windows') ? 'windows' : navigator.userAgent.includes('Mac') ? 'macos' : 'other'
  const term = searchTerm.trim().toLocaleLowerCase()
  const visibleCatalog = snapshot.entries.filter(item => !term || `${item.name} ${item.title} ${item.description} ${item.category} ${item.maintainer} ${item.repo} ${pluginSearchAliases[item.name] || ''}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => {
      if (!term) return 0
      const rank = (item: CatalogItem) => item.name.toLocaleLowerCase() === term ? 0
        : item.name.toLocaleLowerCase().includes(term) ? 1
          : item.title.toLocaleLowerCase().includes(term) ? 2
            : (pluginSearchAliases[item.name] || '').toLocaleLowerCase().includes(term) ? 3 : 4
      return rank(a) - rank(b)
    })

  function search() {
    setSearchTerm(query)
    setLimit(40)
  }

  async function openInstall(item: CatalogItem) {
    if (!connected || !profiles || opening || installing) return
    setOpening(item.name)
    setMessage('')
    const served = new Set(profiles.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]))
    const names = profiles.profiles.map(profile => profile.name).filter(name => served.has(name))
    const results = await Promise.allSettled(names.map(async name => {
      const value = await extensions.request<HermesPluginRuntime>({ kind: 'profile', profile: name }, 'hermesPlugins.list')
      return value.installed.some(plugin => plugin.catalog_name === item.name || plugin.name === item.name)
    }))
    setTargetStatus({
      installed: names.filter((_, index) => results[index].status === 'fulfilled' && results[index].value),
      unavailable: names.filter((_, index) => results[index].status === 'rejected'),
    })
    setSelected(item)
    setOpening('')
  }

  async function installToTargets(targets: string[]) {
    if (!selected || installing || !targets.length) return
    const item = selected
    setInstalling(true)
    setMessage('')
    const failures: string[] = []
    let completed = 0
    for (const profile of targets) {
      try {
        const result = await extensions.request<{ ok: boolean; consent_required?: boolean; scan_blocked?: boolean }>({ kind: 'profile', profile }, 'hermesPlugins.install', { name: item.name })
        if (result.ok !== true || result.consent_required || result.scan_blocked) {
          failures.push(profile)
          continue
        }
        const installed = await extensions.request<HermesPluginRuntime>({ kind: 'profile', profile }, 'hermesPlugins.list')
        if (installed.installed.some(plugin => plugin.catalog_name === item.name || plugin.name === item.name)) completed += 1
        else failures.push(profile)
      } catch (cause) {
        failures.push(`${profile}（${describeError(cause, language)}）`)
      }
    }
    setSelected(null)
    setInstalling(false)
    setMessage(failures.length
      ? (zh ? `已安装到 ${completed} 个 Profile；以下 Profile 未完成：${failures.join('、')}` : `Installed to ${completed} profiles; these did not complete: ${failures.join(', ')}`)
      : (zh ? `已安装到 ${completed} 个 Profile。请在对应 Agent 的「插件」配置查看状态。` : `Installed to ${completed} profiles. Check each Agent's Plugins settings.`))
  }

  function catalogCard(item: CatalogItem) {
    const blocked = removed.has(item.name)
    const supported = !item.platforms.length || item.platforms.some(platform => platform.toLowerCase() === os)
    const link = marketLink(item.docs_url, item.repo)
    const title = item.title || item.name
    return <article className="extension-card market-card" key={item.name}>
      <div className="market-card-header"><h3 className="market-card-title">{link ? <a href={link} target="_blank" rel="noopener noreferrer">{title}</a> : title}</h3><span className="market-card-source">{item.tier}</span></div>
      {title !== item.name && <p><code>{item.name}</code></p>}
      <p className="market-card-description">{item.description}</p>
      <p>{item.category} · {item.maintainer || 'Hermes'} · {item.version || item.sha.slice(0, 8)}</p>
      <p>{zh ? '来源' : 'Source'}: {item.repo}</p>
      <p>{zh ? '固定提交' : 'Pinned commit'}: <code>{item.sha}</code></p>
      {!!item.requires_hermes && <p>Hermes {item.requires_hermes}</p>}
      {!!item.capabilities.requires_env?.length && <p>{zh ? '所需环境变量' : 'Required environment'}: {item.capabilities.requires_env.join(', ')}</p>}
      {blocked && <p>{zh ? '已移除' : 'Removed'}: {removed.get(item.name)}</p>}
      {!supported && <p>{zh ? '当前平台不适用' : 'Not available on this platform'}</p>}
      <div className="market-card-footer">
        <button disabled={!connected || !profiles || blocked || !supported || !!opening || installing} onClick={() => void openInstall(item)}>{opening === item.name ? '…' : zh ? '安装' : 'Install'}</button>
      </div>
    </article>
  }

  return <>
    <h3>{zh ? '插件源列表' : 'Plugin sources'}</h3>
    <p>{zh ? `来源：锁定的 Hermes Agent 目录（提交 ${snapshot.sourceCommit.slice(0, 8)}）。点击安装后选择目标 Profile；已安装插件在 Agent 个人配置管理。` : `Source: pinned Hermes Agent catalog (${snapshot.sourceCommit.slice(0, 8)}). Select target profiles when installing; manage installed plugins in Agent settings.`}</p>
    {!connected && <p>{zh ? '未连接运行时，暂无法安装插件。' : 'Connect the runtime to install plugins.'}</p>}
    <form className="row extension-toolbar" onSubmit={event => { event.preventDefault(); search() }}>
      <input type="search" aria-label={zh ? '搜索 Hermes 插件源' : 'Search Hermes plugin sources'} value={query} onChange={event => { setQuery(event.target.value); setSearchTerm(event.target.value); setLimit(40) }} placeholder={zh ? '搜索名称、说明或来源' : 'Search name, description or source'} />
      <button type="submit">{zh ? '搜索' : 'Search'}</button>
    </form>
    {message && <p role="status">{message}</p>}
    <p role="status">{searchTerm.trim() ? (zh ? `“${searchTerm.trim()}”找到 ${visibleCatalog.length} 个插件源` : `${visibleCatalog.length} plugin sources found for “${searchTerm.trim()}”`) : (zh ? `共 ${visibleCatalog.length} 个插件源` : `${visibleCatalog.length} plugin sources`)}</p>
    {!visibleCatalog.length && <p>{zh ? '没有匹配的插件源。' : 'No matching plugin sources.'}</p>}
    <div className="extension-list">{visibleCatalog.slice(0, limit).map(catalogCard)}</div>
    {limit < visibleCatalog.length && <button onClick={() => setLimit(value => value + 40)}>{zh ? '显示更多' : 'Show more'}</button>}
    {selected && profiles && <TargetProfilesDialog itemName={selected.title || selected.name} profiles={profiles} alreadyInstalled={targetStatus.installed} unavailable={targetStatus.unavailable} busy={installing} onClose={() => setSelected(null)} onConfirm={installToTargets}>
      <div className="target-plugin-details" aria-label={zh ? '插件安装信息' : 'Plugin installation details'}>
        <h3>{zh ? '安装信息' : 'Installation details'}</h3>
        <dl>
          <div><dt>{zh ? '下载来源' : 'Source'}</dt><dd>{selected.repo}</dd></div>
          <div><dt>{zh ? '固定提交' : 'Pinned commit'}</dt><dd><code>{selected.sha}</code></dd></div>
          <div><dt>{zh ? '提供能力' : 'Capabilities'}</dt><dd>{[...(selected.capabilities.provides_tools || []), ...(selected.capabilities.provides_hooks || [])].join(', ') || '-'}</dd></div>
          {!!selected.capabilities.requires_env?.length && <div><dt>{zh ? '所需环境变量' : 'Required environment'}</dt><dd>{selected.capabilities.requires_env.join(', ')}</dd></div>}
        </dl>
      </div>
    </TargetProfilesDialog>}
  </>
}
