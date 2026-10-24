import React from 'react'
import { useLanguage, translateAgentUi, agentFieldTranslation, localizeAgentMessage } from '../../i18n'
import { useDesktop } from '../../app/DesktopContext'
import ConfigFieldEditor from './components/ConfigFieldEditor'
import { fieldTree, nodeLabel, getField, fieldText, type Field, type Schema, type RawConfig, type Provider, type Endpoint, type FieldEntry, type FieldNode } from './model'

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
  const tree = fieldTree(visible)

  function renderField(entry: FieldEntry) {
    const [key] = entry
    return <ConfigFieldEditor key={key} entry={entry} config={config} draft={drafts[key]}
      editing={editingKey === key} busy={busy} language={language} t={t}
      onEdit={editField} onChange={(fieldKey, value) => setDrafts(previous => ({ ...previous, [fieldKey]: value }))}
      onSave={([fieldKey, field]) => void saveField(fieldKey, field)} onCancel={cancelEdit} />
  }

  function renderNode(node: FieldNode): React.ReactNode {
    if (!node.children.size) return node.field && renderField(node.field)
    return <details className="config-tree-node" key={node.path} open={Boolean(query) || expandedPaths.has(node.path)} onToggle={event => {
      if (query) return
      const opened = event.currentTarget.open
      setExpandedPaths(previous => {
        if (previous.has(node.path) === opened) return previous
        const next = new Set(previous)
        if (opened) next.add(node.path)
        else next.delete(node.path)
        return next
      })
    }}>
      <summary>{nodeLabel(language, node, visible)}</summary>
      <div className="config-tree-children">
        {node.field && renderField(node.field)}
        {[...node.children.values()].map(renderNode)}
      </div>
    </details>
  }

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
    {section === 'auxiliary' ? <div className="auxiliary-list"><p>{language === 'zh-CN' ? '按任务选择已配置的提供商。只在主模型中临时填写的自定义端点，请先到“模型提供商”保存为具名提供商。' : 'Choose a configured provider for each task. Save a main-model-only custom endpoint as a named provider first.'}</p>{Object.keys(schema?.fields || {}).filter(key => /^auxiliary\.[^.]+\.provider$/.test(key)).map(key => {
      const task = key.split('.')[1]
      const current = getField(config, `auxiliary.${task}`) as Record<string, unknown> | undefined
      const title = agentFieldTranslation(language, key)?.label.split(/\s*\/\s*/)[1] || task
      const choice = providers.find(item => item.slug === auxProvider)
      return <div className="auxiliary-card" key={task}>
        <div className="row"><strong>{title}</strong><button type="button" disabled={busy} onClick={() => editAuxiliary(task)}>{t('ui.edit')}</button></div>
        {editingTask === task ? <>
          <label>{language === 'zh-CN' ? '提供商' : 'Provider'}<select value={auxProvider} onChange={event => { setAuxProvider(event.target.value); setAuxModel('') }}>
            <option value="auto">{language === 'zh-CN' ? '跟随主模型' : 'Follow main model'}</option>
            {auxProvider !== 'auto' && !providers.some(item => item.slug === auxProvider) && <option value={auxProvider}>{auxProvider} ({language === 'zh-CN' ? '当前配置，不能直接引用' : 'Current route, not reusable'})</option>}
            {providers.map(item => <option key={item.slug} value={item.slug}>{item.name} ({item.slug})</option>)}
          </select></label>
          {auxProvider !== 'auto' && <><label>{language === 'zh-CN' ? '模型' : 'Model'}<input value={auxModel} onChange={event => setAuxModel(event.target.value)} list={`aux-models-${task}`} /></label><datalist id={`aux-models-${task}`}>{choice?.models.map(model => <option value={model} key={model} />)}</datalist></>}
          {schema?.fields[`auxiliary.${task}.reasoning_effort`] && <label>{language === 'zh-CN' ? '推理强度' : 'Reasoning effort'}<select value={auxEffort} onChange={event => setAuxEffort(event.target.value)}><option value="">{language === 'zh-CN' ? '继承默认' : 'Inherit default'}</option>{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
          {schema?.fields[`auxiliary.${task}.timeout`] && <label>{language === 'zh-CN' ? '超时（秒）' : 'Timeout (seconds)'}<input type="number" min="1" value={auxTimeout} onChange={event => setAuxTimeout(event.target.value)} /></label>}
          <div className="config-field-actions"><button disabled={busy || (auxProvider !== 'auto' && (!auxModel.trim() || !providers.some(item => item.slug === auxProvider)))} onClick={() => void saveAuxiliary(task)}>{t('ui.save.setting')}</button><button className="config-field-cancel" onClick={() => setEditingTask(null)}>{t('ui.cancel')}</button></div>
        </> : <small>{current?.provider && current.provider !== 'auto' ? `${String(current.provider)} · ${String(current.model || '')}` : language === 'zh-CN' ? '跟随主模型' : 'Follow main model'}</small>}
      </div>
    })}</div> : <>
    {section === 'advanced' && <div className="config-mode-tabs">
      <button className={mode === 'form' ? 'selected' : ''} onClick={() => { if (canDiscard()) { setMode('form'); setYamlDraft(raw?.yaml || '') } }}>{t("ui.settings.by.category")}</button>
      <button className={mode === 'yaml' ? 'selected' : ''} onClick={() => { if (canDiscard()) { setMode('yaml'); setDrafts({}); setEditingKey(null) } }}>{t("ui.full.yaml")}</button>
    </div>}
    {mode === 'form' || section !== 'advanced' ? <>
      <label>{t("ui.search.settings")}<input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("ui.field.name.or.description")} /></label>
      <div className="config-tree-root">
        <div className="config-tree-root-heading">{t('ui.all.settings')} <span>{visible.length}</span></div>
        <div className="config-fields">{[...tree.children.values()].map(renderNode)}</div>
      </div>
      {visible.length === 0 && <p>{t("ui.no.matching.settings")}</p>}
    </> : <>
      <p>{t("ui.file")}<code>{raw?.path || t("ui.loading")}</code></p>
      <label htmlFor="agent-config-yaml">{t("ui.full.config.yaml")}</label>
      <textarea id="agent-config-yaml" className="config-yaml" value={yamlDraft} onChange={event => setYamlDraft(event.target.value)} spellCheck={false} />
      <div className="actions"><button disabled={busy || !dirtyYaml} onClick={() => void saveYaml()}>{t("ui.save.full.yaml")}</button></div>
    </>}
    </>}
    <p role="status">{localizeAgentMessage(language, status)}</p>
  </section>
}
