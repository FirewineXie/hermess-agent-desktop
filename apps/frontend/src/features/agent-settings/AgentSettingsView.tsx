import { localizeAgentMessage } from '../../i18n'
import ConfigTree from './components/ConfigTree'
import YamlEditor from './components/YamlEditor'
import { useAgentSettingsController } from './useAgentSettingsController'

export default function AgentSettingsView({ connected, profile, epoch, onDirtyChange, onOpenModelSettings, embedded = false }: { connected: boolean; profile: string | null; epoch: string | null; onDirtyChange: (dirty: boolean) => void; onOpenModelSettings: () => void; embedded?: boolean }) {
  const {
    language, t, schema, config, raw, yamlDraft, setYamlDraft,
    drafts, setDrafts, editingKey, setEditingKey, expandedPaths, setExpandedPaths,
    search, setSearch, mode, setMode, section, setSection,
    busy, status, dirtyYaml,
    canDiscard, reload, editField, cancelEdit, saveField, saveYaml,
    visible, query,
  } = useAgentSettingsController({ connected, profile, epoch, onDirtyChange })

  if (!connected) return <section className="settings-panel flat-settings-panel agent-settings"><div className="empty-panel"><h2>{t("ui.start.the.runtime.first")}</h2><p>{t("ui.agent.settings.are.saved.by.this.app.s.hermes.runtime")}</p></div></section>

  return <section className="settings-panel flat-settings-panel agent-settings">
    <div className="row">{!embedded && <h2>{t("ui.hermes.agent.settings")}</h2>}<button disabled={busy} onClick={() => void reload()}>{t("ui.reload")}</button></div>
    <p>{t("ui.fields.come.from.the.current.runtime.schema.save.each.field.separately.full")}</p>
    <div className="config-mode-tabs">
      {(['main', 'approval', 'advanced'] as const).map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => { if (canDiscard()) setSection(item) }}>{({
        main: language === 'zh-CN' ? 'Agent 默认设置' : 'Agent defaults',
        approval: language === 'zh-CN' ? '安全与审批规则' : 'Safety and approvals',
        advanced: language === 'zh-CN' ? '高级设置' : 'Advanced',
      })[item]}</button>)}
    </div>
    {section === 'main' && <>
      <p>{language === 'zh-CN' ? '主模型和默认推理强度在设置中管理。' : 'Manage the main model and default reasoning in Settings.'} <button type="button" onClick={onOpenModelSettings}>{language === 'zh-CN' ? '打开主模型设置' : 'Open main model settings'}</button></p>
    </>}
    <>
    {section === 'advanced' && <div className="config-mode-tabs">
      <button className={mode === 'form' ? 'selected' : ''} onClick={() => { if (canDiscard()) { setMode('form'); setYamlDraft(raw?.yaml || '') } }}>{t("ui.settings.by.category")}</button>
      <button className={mode === 'yaml' ? 'selected' : ''} onClick={() => { if (canDiscard()) { setMode('yaml'); setDrafts({}); setEditingKey(null) } }}>{t("ui.full.yaml")}</button>
    </div>}
    {mode === 'form' || section !== 'advanced' ? <>
      <label>{t("ui.search.settings")}<input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("ui.field.name.or.description")} /></label>
      <ConfigTree visible={visible} queryActive={Boolean(query)} config={config} drafts={drafts}
        editingKey={editingKey} busy={busy} language={language} t={t} expandedPaths={expandedPaths}
        setExpandedPaths={setExpandedPaths} onEdit={editField}
        onChange={(key, value) => setDrafts(previous => ({ ...previous, [key]: value }))}
        onSave={(key, field) => void saveField(key, field)} onCancel={cancelEdit} />
      {visible.length === 0 && <p>{t("ui.no.matching.settings")}</p>}
    </> : <YamlEditor path={raw?.path} draft={yamlDraft} dirty={dirtyYaml} busy={busy}
      t={t} onChange={setYamlDraft} onSave={() => void saveYaml()} />}
    </>
    <p role="status">{localizeAgentMessage(language, status)}</p>
  </section>
}
