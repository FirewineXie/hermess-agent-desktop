import type { ProfileCreateOptions, ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage } from '../../i18n'
import { labels } from './labels'
import { useExtensions } from './useExtensions'
import { useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import SkillHub from './SkillHub'
import McpCatalog from './McpCatalog'
import ExpertCatalog from './ExpertCatalog'
import HermesPlugins from './HermesPlugins'
import './extensions-market.css'

type Category = 'experts' | 'skills' | 'hermesPlugins' | 'mcp'

export default function ExtensionsView({ connected, profiles, epoch, profileBusy, onCreateProfile }: { connected: boolean; profiles: ProfilesSnapshot | null; epoch: string | null; profileBusy: boolean; onCreateProfile: (name: string, options?: ProfileCreateOptions) => Promise<{ name: string; warnings?: string[]; served: boolean } | undefined> }) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const t = labels(language)
  const [category, setCategory] = useProfileState<Category>(workspaceKey(epoch, profiles?.selected), 'experts', 'extensions:category')
  const state = useExtensions(connected, profiles?.selected || null, epoch, category === 'skills' || category === 'mcp' ? category : null)
  const workspace = workspaceKey(epoch, profiles?.selected)
  return <section className="settings-panel flat-settings-panel extensions-panel capability-design-page">
    <div className="extensions-market-heading"><h1>{zh ? '扩展中心' : 'Extension Center'}</h1><p>{zh ? '这里仅用于发现和安装专家预设、技能、插件与 MCP。安装时选择目标 Profile；已安装内容统一在对应 Profile 管理。' : 'Discover and install expert presets, Skills, plugins, and MCP servers here. Choose a target Profile during installation; manage installed items in that Profile.'}</p></div>
    <div className="capability-category-tabs" role="tablist" aria-label={zh ? '能力分类' : 'Capability categories'}>
      {([['experts', zh ? '专家' : 'Experts'], ['skills', zh ? '技能' : 'Skills'], ['hermesPlugins', zh ? 'Hermes 插件' : 'Hermes Plugins'], ['mcp', 'MCP']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={category === id} key={id} onClick={() => setCategory(id)}>{label}</button>)}
    </div>
    {!connected && <p>{t('needsRuntime')}</p>}
    {category === 'experts' && <ExpertCatalog profiles={profiles} busy={profileBusy || !connected} onCreate={onCreateProfile} />}
    {category === 'hermesPlugins' && <HermesPlugins key={workspace} connected={connected} profiles={profiles} />}
    {connected && <>
      {state.message && <p className="extension-message" role="status">{state.message}</p>}
      {category === 'skills' && <SkillHub key={workspace} official={state.official} featured={state.featured} sources={state.sources}
        results={state.results} resultsSource={state.resultsSource} profiles={profiles} busy={state.busy} loading={state.loading} t={t} search={state.searchSkills} loadSources={state.loadSources} request={state.request} installedTargets={state.installedTargets} runForProfiles={state.runForProfiles} onMessage={state.setMessage} />}
      {category === 'mcp' && <McpCatalog entries={state.catalog} results={state.catalogResults}
        resultsSource={state.catalogResultsSource} profiles={profiles} busy={state.busy} loading={state.loading}
        t={t} search={state.searchCatalog} installedTargets={state.installedTargets} runForProfiles={state.runForProfiles} onMessage={state.setMessage} />}
    </>}
  </section>
}
