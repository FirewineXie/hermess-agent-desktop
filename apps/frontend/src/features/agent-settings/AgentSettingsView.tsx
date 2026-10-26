import { localizeAgentMessage } from '../../i18n'
import AuxiliaryTaskCard from './components/AuxiliaryTaskCard'
import ConfigTree from './components/ConfigTree'
import DefaultReasoningField from './components/DefaultReasoningField'
import YamlEditor from './components/YamlEditor'
import { useAgentSettingsController } from './useAgentSettingsController'

export default function AgentSettingsView({ connected, profile, epoch, storagePath, onDirtyChange, onOpenModelSettings }: { connected: boolean; profile: string | null; epoch: string | null; storagePath: string; onDirtyChange: (dirty: boolean) => void; onOpenModelSettings: () => void }) {
  const {
    language, t, schema, config, raw, yamlDraft, setYamlDraft,
    drafts, setDrafts, editingKey, setEditingKey, expandedPaths, setExpandedPaths,
    search, setSearch, mode, setMode, section, setSection, providers,
    editingTask, setEditingTask, auxProvider, setAuxProvider, auxModel, setAuxModel,
    auxEffort, setAuxEffort, auxTimeout, setAuxTimeout, busy, status, dirtyYaml,
    canDiscard, reload, editField, cancelEdit, saveField, saveYaml,
    editAuxiliary, saveAuxiliary, visible, query, auxiliaryTasks,
  } = useAgentSettingsController({ connected, profile, epoch, storagePath, onDirtyChange })

  if (!connected) return <section className="settings-panel flat-settings-panel agent-settings"><div className="empty-panel"><h2>{t("ui.start.the.runtime.first")}</h2><p>{t("ui.agent.settings.are.saved.by.this.app.s.hermes.runtime")}</p></div></section>

  return <section className="settings-panel flat-settings-panel agent-settings">
    <div className="row"><h2>{t("ui.hermes.agent.settings")}</h2><button disabled={busy} onClick={() => void reload()}>{t("ui.reload")}</button></div>
    <p>{t("ui.fields.come.from.the.current.runtime.schema.save.each.field.separately.full")}</p>
    <div className="config-mode-tabs">
      {(['main', 'auxiliary', 'approval', 'advanced'] as const).map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => { if (canDiscard()) { setSection(item); setEditingTask(null) } }}>{({
        main: language === 'zh-CN' ? 'Agent 默认设置' : 'Agent defaults',
        auxiliary: language === 'zh-CN' ? '辅助模型' : 'Auxiliary models',
        approval: language === 'zh-CN' ? '安全与审批规则' : 'Safety and approvals',
        advanced: language === 'zh-CN' ? '高级设置' : 'Advanced',
      })[item]}</button>)}
    </div>
    {section === 'main' && <>
      <p>{language === 'zh-CN' ? '默认模型和提供商在模型提供商页面管理。' : 'Manage the default model and providers on the model providers page.'} <button type="button" onClick={onOpenModelSettings}>{language === 'zh-CN' ? '打开模型提供商' : 'Open model providers'}</button></p>
      {schema && <DefaultReasoningField field={{ type: 'string' }}
        config={config} draft={drafts['agent.reasoning_effort']} busy={busy} language={language}
        onChange={value => setDrafts(previous => ({ ...previous, 'agent.reasoning_effort': value }))}
        onSave={() => void saveField('agent.reasoning_effort', { type: 'string' })} />}
    </>}
    {section === 'auxiliary' ? <div className="auxiliary-list">
      <p>{language === 'zh-CN' ? '按任务选择已配置的提供商。只在主模型中临时填写的自定义端点，请先到“模型提供商”保存为具名提供商。' : 'Choose a configured provider for each task. Save a main-model-only custom endpoint as a named provider first.'}</p>
      {auxiliaryTasks.map(task => <AuxiliaryTaskCard key={task} task={task} config={config} schema={schema} providers={providers}
        editing={editingTask === task} provider={auxProvider} model={auxModel} effort={auxEffort} timeout={auxTimeout}
        busy={busy} language={language} t={t} onEdit={editAuxiliary} onProviderChange={setAuxProvider}
        onModelChange={setAuxModel} onEffortChange={setAuxEffort} onTimeoutChange={setAuxTimeout}
        onSave={task => void saveAuxiliary(task)} onCancel={() => setEditingTask(null)} />)}
    </div> : <>
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
    </>}
    <p role="status">{localizeAgentMessage(language, status)}</p>
  </section>
}
