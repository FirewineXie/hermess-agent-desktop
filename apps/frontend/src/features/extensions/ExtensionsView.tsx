import { useLanguage } from '../../i18n'
import { labels } from './labels'
import type { ExtensionTab } from './model'
import { useExtensions } from './useExtensions'
import LocalSkills from './LocalSkills'
import LocalMcp from './LocalMcp'
import SkillHub from './SkillHub'
import McpCatalog from './McpCatalog'

const tabs: ExtensionTab[] = ['skills', 'mcp', 'skillHub', 'mcpCatalog']

export default function ExtensionsView({ connected }: { connected: boolean }) {
  const t = labels(useLanguage())
  const state = useExtensions(connected)
  return <section className="settings-panel flat-settings-panel extensions-panel">
    <div className="row"><h2>{t('title')}</h2><button disabled={!connected || state.loading || state.busy} onClick={() => void state.refresh()}>{state.loading ? t('loading') : t('refresh')}</button></div>
    <div className="extension-tabs" role="tablist" aria-label={t('title')}>
      {tabs.map(tab => <button type="button" role="tab" aria-selected={state.tab === tab} className={state.tab === tab ? 'selected' : ''}
        key={tab} onClick={() => state.setTab(tab)}>{t(tab)}</button>)}
    </div>
    {!connected && <p>{t('needsRuntime')}</p>}
    {connected && <>
      {state.message && <p className="extension-message" role="status">{state.message}</p>}
      {state.tab === 'skills' && <LocalSkills skills={state.skills} busy={state.busy} t={t} request={state.request} run={state.run} onError={state.setMessage} />}
      {state.tab === 'mcp' && <LocalMcp servers={state.servers} busy={state.busy} t={t} request={state.request} run={state.run} onMessage={state.setMessage} />}
      {state.tab === 'skillHub' && <SkillHub official={state.official} featured={state.featured} sources={state.sources} installed={state.installed}
        results={state.results} resultsSource={state.resultsSource} busy={state.busy} loading={state.loading} t={t} search={state.searchSkills} request={state.request} run={state.run} onMessage={state.setMessage} />}
      {state.tab === 'mcpCatalog' && <McpCatalog entries={state.catalog} results={state.catalogResults}
        resultsSource={state.catalogResultsSource} servers={state.servers} busy={state.busy} loading={state.loading}
        t={t} search={state.searchCatalog} request={state.request} run={state.run} onMessage={state.setMessage} />}
    </>}
  </section>
}
