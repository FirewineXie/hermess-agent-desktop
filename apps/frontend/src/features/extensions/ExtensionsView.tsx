import React from 'react'
import type { ProfilePresetSelection, ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage } from '../../i18n'
import { labels } from './labels'
import { useExtensions } from './useExtensions'
import { useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import SkillHub from './SkillHub'
import McpCatalog from './McpCatalog'
import ExpertCatalog from './ExpertCatalog'
import HermesPlugins from './HermesPlugins'

type Category = 'experts' | 'skills' | 'hermesPlugins' | 'mcp'

export default function ExtensionsView({ connected, profiles, epoch, profileBusy, onCreateProfile, onImportProfile }: { connected: boolean; profiles: ProfilesSnapshot | null; epoch: string | null; profileBusy: boolean; onCreateProfile: (name: string, preset?: ProfilePresetSelection) => Promise<{ name: string; warnings?: string[]; served: boolean } | undefined>; onImportProfile: (path: string, name: string, digest: string) => Promise<{ name: string; served: boolean } | undefined> }) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const t = labels(language)
  const state = useExtensions(connected, profiles?.selected || null, epoch)
  const workspace = workspaceKey(epoch, profiles?.selected)
  const [category, setCategory] = useProfileState<Category>(workspace, 'experts', 'extensions:category')
  React.useEffect(() => {
    if (category === 'skills' && state.tab !== 'skillHub') state.setTab('skillHub')
    if (category === 'mcp' && state.tab !== 'mcpCatalog') state.setTab('mcpCatalog')
  }, [category, state.tab])
  function selectCategory(next: Category) {
    setCategory(next)
    if (next === 'skills') state.setTab('skillHub')
    if (next === 'mcp') state.setTab('mcpCatalog')
  }
  return <section className="settings-panel flat-settings-panel extensions-panel capability-design-page">
    <div className="capability-category-tabs" role="tablist" aria-label={zh ? '能力分类' : 'Capability categories'}>
      {([['experts', zh ? '专家' : 'Experts'], ['skills', zh ? '技能' : 'Skills'], ['hermesPlugins', zh ? 'Hermes 插件' : 'Hermes Plugins'], ['mcp', 'MCP']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={category === id} key={id} onClick={() => selectCategory(id)}>{label}</button>)}
    </div>
    {!connected && <p>{t('needsRuntime')}</p>}
    {category === 'experts' && <ExpertCatalog profiles={profiles} busy={profileBusy || !connected} onCreate={onCreateProfile} onImport={onImportProfile} />}
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
