import React from 'react'
import { localizeAgentMessage } from '../../i18n'
import { SettingsSearchTarget } from '../settings/SettingsSearchTarget'
import { auxiliaryTaskFromField } from '../settings/fieldSearch'
import AuxiliaryTaskCard from './components/AuxiliaryTaskCard'
import ConfigTree from './components/ConfigTree'
import DefaultReasoningField from './components/DefaultReasoningField'
import YamlEditor from './components/YamlEditor'
import FallbackModelsEditor from './components/FallbackModelsEditor'
import { getField } from './model'
import { useAgentSettingsController } from './useAgentSettingsController'

export default function AgentSettingsView({ connected, profile, epoch, storagePath, onDirtyChange, onOpenModelSettings, embedded = false, sectionOverride }: { connected: boolean; profile: string | null; epoch: string | null; storagePath: string; onDirtyChange: (dirty: boolean) => void; onOpenModelSettings: () => void; embedded?: boolean; sectionOverride?: string }) {
  const searchTarget = React.useContext(SettingsSearchTarget)
  const {
    language, t, schema, config, raw, yamlDraft, setYamlDraft,
    drafts, setDrafts, editingKey, setEditingKey, expandedPaths, setExpandedPaths,
    search, setSearch, mode, setMode, section, setSection, providers,
    editingTask, setEditingTask, auxProvider, setAuxProvider, auxModel, setAuxModel,
    auxEffort, setAuxEffort, auxTimeout, setAuxTimeout, busy, status, dirtyYaml,
    canDiscard, reload, editField, cancelEdit, saveField, saveYaml,
    editAuxiliary, saveAuxiliary, visible, query, auxiliaryTasks, auxiliarySummary, auxiliaryLoadFailed, staleAuxiliary,
  } = useAgentSettingsController({ connected, profile, epoch, storagePath, onDirtyChange, sectionOverride })
  const setSearchRef = React.useRef(setSearch)
  const setModeRef = React.useRef(setMode)
  setSearchRef.current = setSearch
  setModeRef.current = setMode
  const auxiliarySearchTask = sectionOverride === 'model.auxiliary' && searchTarget?.location.category === 'model'
    && searchTarget.location.subpage === 'auxiliary' ? auxiliaryTaskFromField(searchTarget.field) : null
  const auxiliaryTasksKey = auxiliaryTasks.join('|')

  React.useEffect(() => {
    if (!embedded || !sectionOverride || !searchTarget) return
    if (`${searchTarget.location.category}.${searchTarget.location.subpage}` !== sectionOverride) return
    if (sectionOverride === 'advanced.raw') setModeRef.current('form')
    setSearchRef.current(auxiliaryTaskFromField(searchTarget.field) ? '' : searchTarget.field)
    document.querySelector('.settings-content-scroll')?.scrollTo({ top: 0 })
  }, [embedded, searchTarget, sectionOverride])

  React.useEffect(() => {
    if (section !== 'model.auxiliary' || !auxiliarySearchTask || !auxiliaryTasks.includes(auxiliarySearchTask)) return
    document.getElementById(`auxiliary-task-${auxiliarySearchTask}`)?.scrollIntoView({ block: 'center' })
  }, [section, searchTarget, auxiliarySearchTask, auxiliaryTasksKey])

  const auxiliarySection = section === 'auxiliary' || section === 'model.auxiliary'
  const rawSection = section === 'advanced.raw'

  if (!connected) return <section className="settings-panel flat-settings-panel agent-settings"><div className="empty-panel"><h2>{t("ui.start.the.runtime.first")}</h2><p>{t("ui.agent.settings.are.saved.by.this.app.s.hermes.runtime")}</p></div></section>

  return <section className="settings-panel flat-settings-panel agent-settings">
    <div className="row">{!embedded && <h2>{t("ui.hermes.agent.settings")}</h2>}<button disabled={busy} onClick={() => void reload()}>{section === 'model.main' ? (language === 'zh-CN' ? '重新读取模型参数' : 'Reload model parameters') : t("ui.reload")}</button></div>
    <p>{section === 'model.main'
      ? (language === 'zh-CN' ? '上下文长度、推理强度和服务档位按当前 Profile 的运行时 Schema 单独保存。' : 'Context length, reasoning effort, and service tier are saved separately using the current Profile schema.')
      : t("ui.fields.come.from.the.current.runtime.schema.save.each.field.separately.full")}</p>
    {!sectionOverride && <div className="config-mode-tabs">
      {(['main', 'auxiliary', 'approval', 'advanced'] as const).map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => { if (canDiscard()) { setSection(item); setEditingTask(null) } }}>{({
        main: language === 'zh-CN' ? 'Agent 默认设置' : 'Agent defaults',
        auxiliary: language === 'zh-CN' ? '辅助模型' : 'Auxiliary models',
        approval: language === 'zh-CN' ? '安全与审批规则' : 'Safety and approvals',
        advanced: language === 'zh-CN' ? '高级设置' : 'Advanced',
      })[item]}</button>)}
    </div>}
    {section === 'main' && <>
      <p>{language === 'zh-CN' ? '默认模型和提供商在模型提供商页面管理。' : 'Manage the default model and providers on the model providers page.'} <button type="button" onClick={onOpenModelSettings}>{language === 'zh-CN' ? '打开模型提供商' : 'Open model providers'}</button></p>
      {schema && <DefaultReasoningField field={{ type: 'string' }}
        config={config} draft={drafts['agent.reasoning_effort']} busy={busy} language={language}
        onChange={value => setDrafts(previous => ({ ...previous, 'agent.reasoning_effort': value }))}
        onSave={() => void saveField('agent.reasoning_effort', { type: 'string' })} />}
    </>}
    {auxiliarySection ? <div className="auxiliary-list">
      <p>{language === 'zh-CN' ? '按任务选择已配置的提供商。只在主模型中临时填写的自定义端点，请先到“模型提供商”保存为具名提供商。' : 'Choose a configured provider for each task. Save a main-model-only custom endpoint as a named provider first.'}</p>
      {auxiliaryLoadFailed && <p role="status">{language === 'zh-CN' ? '运行时任务目录读取失败，当前按配置 Schema 显示；固定路由提示暂不可用。' : 'Could not load the runtime task catalog. Showing config schema tasks; pinned-route warnings are unavailable.'}</p>}
      {staleAuxiliary.length > 0 && <p className="auxiliary-route-warning" role="alert">{language === 'zh-CN'
        ? `这些辅助任务仍固定到不同于主模型的提供商：${staleAuxiliary.map(task => `${task.label || task.task} (${task.provider})`).join('、')}。切换主模型不会自动修改它们，请逐项确认或改为“跟随主模型”。`
        : `These auxiliary tasks remain pinned to providers other than the main model: ${staleAuxiliary.map(task => `${task.label || task.task} (${task.provider})`).join(', ')}. Review each task or set it to follow the main model.`}</p>}
      {auxiliaryTasks.map(task => <AuxiliaryTaskCard key={task} task={task} searchTarget={auxiliarySearchTask === task} assignment={auxiliarySummary?.tasks.find(item => item.task === task)} config={config} schema={schema} providers={providers}
        editing={editingTask === task} provider={auxProvider} model={auxModel} effort={auxEffort} timeout={auxTimeout}
        busy={busy} language={language} t={t} onEdit={editAuxiliary} onProviderChange={setAuxProvider}
        onModelChange={setAuxModel} onEffortChange={setAuxEffort} onTimeoutChange={setAuxTimeout}
        onSave={task => void saveAuxiliary(task)} onCancel={() => setEditingTask(null)} />)}
    </div> : <>
    {section === 'model.fallbacks' && schema?.fields.fallback_providers && <FallbackModelsEditor key={`${epoch}:${profile}:${JSON.stringify(getField(config, 'fallback_providers'))}`} value={getField(config, 'fallback_providers')} providers={providers} busy={busy} language={language} onChange={rows => setDrafts(previous => ({ ...previous, fallback_providers: JSON.stringify(rows, null, 2) }))} onSave={() => void saveField('fallback_providers', schema.fields.fallback_providers)} />}
    {(section === 'advanced' || rawSection) && <div className="config-mode-tabs">
      <button className={mode === 'form' ? 'selected' : ''} onClick={() => { if (canDiscard()) { setMode('form'); setYamlDraft(raw?.yaml || '') } }}>{t("ui.settings.by.category")}</button>
      <button className={mode === 'yaml' ? 'selected' : ''} onClick={() => { if (canDiscard()) { setMode('yaml'); setDrafts({}); setEditingKey(null) } }}>{t("ui.full.yaml")}</button>
    </div>}
    {((section !== 'advanced' && !rawSection) || mode === 'form') ? <>
      <label>{t("ui.search.settings")}<input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("ui.field.name.or.description")} /></label>
      {section !== 'model.fallbacks' && <ConfigTree visible={visible} queryActive={Boolean(query)} config={config} drafts={drafts}
        editingKey={editingKey} busy={busy} language={language} t={t} expandedPaths={expandedPaths}
        setExpandedPaths={setExpandedPaths} onEdit={editField}
        onChange={(key, value) => setDrafts(previous => ({ ...previous, [key]: value }))}
        onSave={(key, field) => void saveField(key, field)} onCancel={cancelEdit} />}
      {visible.length === 0 && <p>{t("ui.no.matching.settings")}</p>}
    </> : <YamlEditor path={raw?.path} draft={yamlDraft} dirty={dirtyYaml} busy={busy}
      t={t} onChange={setYamlDraft} onSave={() => void saveYaml()} />}
    </>}
    <p role="status">{localizeAgentMessage(language, status)}</p>
  </section>
}
