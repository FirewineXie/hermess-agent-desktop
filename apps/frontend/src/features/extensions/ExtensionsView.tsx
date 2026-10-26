import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage } from '../../i18n'
import { clientProfilePresets } from '../profiles/presets'
import { labels } from './labels'
import type { ExtensionTab } from './model'
import { useExtensions } from './useExtensions'
import LocalSkills from './LocalSkills'
import LocalMcp from './LocalMcp'
import SkillHub from './SkillHub'
import McpCatalog from './McpCatalog'

type Category = 'experts' | 'skills' | 'mcp'

export default function ExtensionsView({ connected, profiles, profileBusy, onSelectProfile, onOpenProfiles }: { connected: boolean; profiles: ProfilesSnapshot | null; profileBusy: boolean; onSelectProfile: (name: string) => Promise<unknown>; onOpenProfiles: () => void }) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const t = labels(language)
  const state = useExtensions(connected)
  const [category, setCategory] = React.useState<Category>('skills')
  const [query, setQuery] = React.useState('')

  function selectCategory(next: Category) {
    setCategory(next)
    if (next === 'skills' && !['skills', 'skillHub'].includes(state.tab)) state.setTab('skillHub')
    if (next === 'mcp' && !['mcp', 'mcpCatalog'].includes(state.tab)) state.setTab('mcpCatalog')
  }
  function search(event: React.FormEvent) {
    event.preventDefault()
    if (category === 'skills') { state.setTab('skillHub'); void state.searchSkills(query, 'all') }
    if (category === 'mcp') { state.setTab('mcpCatalog'); void state.searchCatalog(query, 'all') }
  }
  const expertMatches = clientProfilePresets.filter(preset => `${preset.title[language]} ${preset.description[language]}`.toLowerCase().includes(query.toLowerCase()))
  const subtabs: ExtensionTab[] = category === 'skills' ? ['skillHub', 'skills'] : ['mcpCatalog', 'mcp']
  const servedProfiles = new Set(profiles?.gateways.flatMap(gateway => gateway.served_profiles || [gateway.profile]) || [])

  return <section className="settings-panel flat-settings-panel extensions-panel capability-design-page">
    <form className="capability-searchbar" onSubmit={search}><input aria-label={zh ? '搜索专家、技能、插件' : 'Search experts, skills and plugins'} placeholder={zh ? '搜索专家、技能、插件' : 'Search experts, skills and plugins'} value={query} onChange={event => setQuery(event.target.value)} />
      <button type="submit" disabled={state.loading}>{zh ? '搜索' : 'Search'}</button><button type="button" onClick={() => void state.refresh()} disabled={!connected || state.loading || state.busy}>{state.loading ? t('loading') : t('refresh')}</button></form>
    <div className="capability-category-tabs" role="tablist" aria-label={zh ? '能力分类' : 'Capability categories'}>
      {([['experts', zh ? '专家' : 'Experts'], ['skills', zh ? '技能 · 插件' : 'Skills · Plugins'], ['mcp', 'MCP']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={category === id} key={id} onClick={() => selectCategory(id)}>{label}</button>)}
    </div>
    {connected && profiles && <label className="capability-target-profile">{zh ? '安装与连接到' : 'Install and connect to'}<select value={profiles.selected} disabled={profileBusy} onChange={event => void onSelectProfile(event.target.value)}>{profiles.profiles.map(profile => <option value={profile.name} key={profile.name} disabled={!servedProfiles.has(profile.name)}>{profile.display_name || profile.name}{!servedProfiles.has(profile.name) ? (zh ? '（未启用）' : ' (not serving)') : ''}</option>)}</select></label>}
    {category !== 'experts' && <div className="capability-subtabs">{subtabs.map(tab => <button type="button" className={state.tab === tab ? 'selected' : ''} key={tab} onClick={() => state.setTab(tab)}>{t(tab)}</button>)}</div>}
    {!connected && <p>{t('needsRuntime')}</p>}
    {connected && <>
      {state.message && <p className="extension-message" role="status">{state.message}</p>}
      {category === 'experts' && <div className="capability-experts">{expertMatches.map(preset => <article className="capability-expert-card" key={preset.id}><h3>{preset.title[language]}</h3><p>{preset.description[language]}</p><small>Skill: {preset.skills.join('、') || (zh ? '无' : 'None')}</small><button onClick={onOpenProfiles}>{zh ? '选择目标 Profile' : 'Choose target profile'}</button></article>)}{expertMatches.length === 0 && <p>{t('noResults')}</p>}</div>}
      {category === 'skills' && state.tab === 'skills' && <LocalSkills skills={state.skills} busy={state.busy} t={t} request={state.request} run={state.run} onError={state.setMessage} />}
      {category === 'mcp' && state.tab === 'mcp' && <LocalMcp servers={state.servers} busy={state.busy} t={t} request={state.request} run={state.run} onMessage={state.setMessage} />}
      {category === 'skills' && state.tab === 'skillHub' && <SkillHub official={state.official} featured={state.featured} sources={state.sources} installed={state.installed}
        results={state.results} resultsSource={state.resultsSource} busy={state.busy} loading={state.loading} t={t} search={state.searchSkills} request={state.request} run={state.run} onMessage={state.setMessage} />}
      {category === 'mcp' && state.tab === 'mcpCatalog' && <McpCatalog entries={state.catalog} results={state.catalogResults}
        resultsSource={state.catalogResultsSource} servers={state.servers} busy={state.busy} loading={state.loading}
        t={t} search={state.searchCatalog} request={state.request} run={state.run} onMessage={state.setMessage} />}
    </>}
  </section>
}
