import React from 'react'
import { useLanguage, translateAgentUi, agentFieldTranslation, localizeAgentMessage } from '../../i18n'
import { useDesktop } from '../../app/DesktopContext'
import AuxiliaryTaskCard from './components/AuxiliaryTaskCard'
import ConfigTree from './components/ConfigTree'
import YamlEditor from './components/YamlEditor'
import { getField, fieldText, type Field, type Schema, type RawConfig, type Provider } from './model'

export default function AgentSettingsView({ connected, storagePath, onDirtyChange, onOpenModelSettings }: { connected: boolean; storagePath: string; onDirtyChange: (dirty: boolean) => void; onOpenModelSettings: () => void }) {
  const { agentSettings, models } = useDesktop()
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateAgentUi(languageRef.current, key, ...values), [])
  const [schema, setSchema] = React.useState<Schema | null>(null)
  const [config, setConfig] = React.useState<Record<string, unknown>>({})
  const [raw, setRaw] = React.useState<RawConfig | null>(null)
  const [yamlDraft, setYamlDraft] = React.useState('')
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = React.useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(() => new Set())
  const [search, setSearch] = React.useState('')
  const [mode, setMode] = React.useState<'form' | 'yaml'>('form')
  const [section, setSection] = React.useState<'main' | 'auxiliary' | 'approval' | 'advanced'>('auxiliary')
  const [providers, setProviders] = React.useState<Provider[]>([])
  const [editingTask, setEditingTask] = React.useState<string | null>(null)
  const [auxProvider, setAuxProvider] = React.useState('auto')
  const [auxModel, setAuxModel] = React.useState('')
  const [auxEffort, setAuxEffort] = React.useState('')
  const [auxTimeout, setAuxTimeout] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')

  const load = React.useCallback(async (savedKey?: string) => {
    if (!connected) return false
    setBusy(true)
    setStatus(t("ui.loading.agent.settings"))
    try {
      const [nextSchema, nextConfig, nextRaw] = await Promise.all([
        agentSettings.schema(),
        agentSettings.config(),
        agentSettings.raw(),
      ])
      const [options, endpoints, savedLists] = await Promise.allSettled([
        models.options({ refresh: false, includeUnconfigured: false }),
        models.endpoints(),
        models.loadLists(storagePath),
      ])
      const choices = options.status === 'fulfilled'
        ? (options.value.providers || []).filter(item => item.authenticated !== false && !['copilot-acp', 'custom'].includes(item.slug)) : []
      if (endpoints.status === 'fulfilled') for (const endpoint of endpoints.value.endpoints || []) {
        if (endpoint.source === 'direct-config' || choices.some(item => item.slug === endpoint.id
          || (endpoint.source === 'custom_providers' && item.name === endpoint.name
            && item.api_url?.replace(/\/+$/, '').toLowerCase() === endpoint.base_url.replace(/\/+$/, '').toLowerCase()))) continue
        choices.push({ slug: endpoint.id, name: endpoint.name, models: endpoint.models.length ? endpoint.models : [endpoint.model].filter(Boolean) })
      }
      if (savedLists.status === 'fulfilled' && savedLists.value) for (const choice of choices) {
        const endpoint = endpoints.status === 'fulfilled'
          ? endpoints.value.endpoints.find(item => item.id === choice.slug
            || (choice.api_url && item.name === choice.name
              && item.base_url.replace(/\/+$/, '').toLowerCase() === choice.api_url.replace(/\/+$/, '').toLowerCase()))
          : undefined
        const saved = savedLists.value[endpoint?.id || choice.slug] ?? savedLists.value[choice.slug]
        if (saved !== undefined) choice.models = saved
      }
      setProviders(choices)
      setSchema(nextSchema)
      setConfig(nextConfig)
      setRaw(nextRaw)
      setYamlDraft(nextRaw.yaml)
      setDrafts(previous => {
        if (!savedKey) return {}
        const remaining = { ...previous }
        delete remaining[savedKey]
        return remaining
      })
      setStatus(t("ui.current.runtime.configuration.loaded"))
      return true
    } catch (error) { setStatus(t("ui.load.failed.arg", String(error))); return false }
    finally { setBusy(false) }
  }, [connected, storagePath])

  React.useEffect(() => { void load() }, [load])

  const dirtyYaml = raw !== null && yamlDraft !== raw.yaml
  const dirtyFields = Object.entries(drafts).some(([key, value]) =>
    value !== fieldText(getField(config, key), schema?.fields[key]?.type || 'string'))
  const currentAux = editingTask ? getField(config, `auxiliary.${editingTask}`) as Record<string, unknown> | undefined : undefined
  const dirtyAux = Boolean(editingTask && (
    auxProvider !== String(currentAux?.provider || 'auto') ||
    auxModel !== String(currentAux?.model || '') ||
    auxEffort !== String(currentAux?.reasoning_effort || '') ||
    auxTimeout !== String(currentAux?.timeout ?? '')
  ))
  React.useEffect(() => { onDirtyChange(dirtyYaml || dirtyFields || dirtyAux) }, [dirtyYaml, dirtyFields, dirtyAux, onDirtyChange])
  function canDiscard() {
    return !(dirtyYaml || dirtyFields || dirtyAux) || window.confirm(t("ui.you.have.unsaved.settings.discard.changes"))
  }
  async function reload() { if (canDiscard() && await load()) { setEditingKey(null); setEditingTask(null) } }

  function editField(key: string) {
    if (dirtyFields && !canDiscard()) return
    setDrafts({})
    setEditingKey(key)
  }

  function cancelEdit() {
    if (dirtyFields && !canDiscard()) return
    setDrafts({})
    setEditingKey(null)
  }

  async function saveField(key: string, field: Field) {
    const text = drafts[key]
    if (text === undefined) return
    let value: unknown = text
    try {
      if (field.type === 'number') {
        if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(t("ui.enter.a.valid.number"))
        value = Number(text)
      } else if (field.type === 'boolean') value = text === 'true'
      else if (field.type === 'list' || field.type === 'object') {
        value = JSON.parse(text)
        if (field.type === 'list' ? !Array.isArray(value) : value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(t("ui.enter.a.valid.json.arg", t(field.type === 'list' ? 'ui.array' : 'ui.object')))
        }
      }
    } catch (error) { setStatus(`${key}：${String(error)}`); return }
    setBusy(true)
    try {
      await agentSettings.saveField(key, value)
      if (await load(key)) {
        setEditingKey(null)
        setStatus(t("ui.arg.saved.some.settings.take.effect.in.a.new.session.or.after.restarting.th", key))
      }
    } catch (error) { setStatus(t("ui.failed.to.save.arg.arg", key, String(error))) }
    finally { setBusy(false) }
  }

  async function saveYaml() {
    if (!dirtyYaml) return
    if (!window.confirm(t("ui.the.raw.yaml.will.replace.all.of.config.yaml.save.the.complete.content"))) return
    setBusy(true)
    try {
      await agentSettings.saveRaw(yamlDraft, raw?.yaml || '')
      if (await load()) setStatus(t("ui.full.configuration.saved.some.settings.take.effect.in.a.new.session.or.afte"))
    } catch (error) { setStatus(t("ui.save.failed.arg", String(error))) }
    finally { setBusy(false) }
  }

  function editAuxiliary(task: string) {
    if (editingTask === task) return
    if (!canDiscard()) return
    const current = getField(config, `auxiliary.${task}`) as Record<string, unknown> | undefined
    setAuxProvider(String(current?.provider || 'auto'))
    setAuxModel(String(current?.model || ''))
    setAuxEffort(String(current?.reasoning_effort || ''))
    setAuxTimeout(String(current?.timeout ?? ''))
    setEditingTask(task)
  }

  async function saveAuxiliary(task: string) {
    if (auxTimeout && (!Number.isFinite(Number(auxTimeout)) || Number(auxTimeout) <= 0)) {
      setStatus(language === 'zh-CN' ? '超时必须是正数' : 'Timeout must be positive')
      return
    }
    setBusy(true)
    try {
      await agentSettings.saveAuxiliary({
        task, provider: auxProvider, model: auxProvider === 'auto' ? '' : auxModel,
        effort: auxEffort, timeout: auxTimeout ? Number(auxTimeout) : null,
      })
      if (await load()) {
        setEditingTask(null)
        setStatus(language === 'zh-CN' ? '辅助模型配置已保存；新会话或下次调用时生效' : 'Auxiliary model saved; applies to a new session or the next call')
      }
    } catch (error) { setStatus(String(error)) }
    finally { setBusy(false) }
  }

  if (!connected) return <section className="settings-panel flat-settings-panel agent-settings"><div className="empty-panel"><h2>{t("ui.start.the.runtime.first")}</h2><p>{t("ui.agent.settings.are.saved.by.this.app.s.hermes.runtime")}</p></div></section>

  const entries = Object.entries(schema?.fields || {})
  const query = search.trim().toLowerCase()
  const scoped = entries.filter(([key]) => {
    if (section === 'advanced') return true
    if (section === 'main') return ['agent.reasoning_effort', 'agent.reasoning_overrides', 'agent.max_turns', 'model_context_length'].includes(key)
    if (section === 'approval') return key.startsWith('approvals.') || key.startsWith('security.')
    return false
  })
  const visible = scoped.filter(([key, field]) => !query ||
    `${key} ${field.description || ''} ${agentFieldTranslation(language, key)?.label || ''} ${agentFieldTranslation(language, key)?.description || ''}`.toLowerCase().includes(query))
  const auxiliaryTasks = Object.keys(schema?.fields || {}).filter(key => /^auxiliary\.[^.]+\.provider$/.test(key)).map(key => key.split('.')[1])
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
    {section === 'main' && <p>{language === 'zh-CN' ? '默认模型和提供商在模型提供商页面管理。' : 'Manage the default model and providers on the model providers page.'} <button type="button" onClick={onOpenModelSettings}>{language === 'zh-CN' ? '打开模型提供商' : 'Open model providers'}</button></p>}
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
