import React from 'react'
import { useLanguage, translateAgentUi, agentFieldTranslation } from '../../i18n'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileRef, useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import { describeError } from '../../app/desktopErrors'
import { getField, fieldText, type Field, type Schema, type RawConfig, type Provider } from './model'

type Options = {
  connected: boolean
  profile: string | null
  epoch: string | null
  storagePath: string
  onDirtyChange: (dirty: boolean) => void
}

export function useAgentSettingsController({ connected, profile, epoch, storagePath, onDirtyChange }: Options) {
  const { agentSettings, models } = useDesktop()
  const workspace = workspaceKey(epoch, profile)
  let stateSlot = 0
  const useState = <T,>(initial: T | (() => T)) => useProfileState(workspace, initial, `agent-settings:${stateSlot++}`)
  function profileScope() {
    if (!profile) throw new Error('No active Profile')
    return { kind: 'profile' as const, profile }
  }
  const language = useLanguage()
  const languageRef = React.useRef(language)
  languageRef.current = language
  const t = React.useCallback((key: string, ...values: unknown[]) => translateAgentUi(languageRef.current, key, ...values), [])
  const [schema, setSchema] = useState<Schema | null>(null)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [raw, setRaw] = useState<RawConfig | null>(null)
  const [yamlDraft, setYamlDraft] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'form' | 'yaml'>('form')
  const [section, setSection] = useState<'main' | 'auxiliary' | 'approval' | 'advanced'>('auxiliary')
  const [providers, setProviders] = useState<Provider[]>([])
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [auxProvider, setAuxProvider] = useState('auto')
  const [auxModel, setAuxModel] = useState('')
  const [auxEffort, setAuxEffort] = useState('')
  const [auxTimeout, setAuxTimeout] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [loaded, setLoaded] = useState(false)
  const loadRequestRef = useProfileRef(workspace, 0)

  const load = React.useCallback(async (savedKey?: string) => {
    if (!connected || !profile) return false
    const scope = { kind: 'profile' as const, profile }
    const request = ++loadRequestRef.current
    setBusy(true)
    setStatus(t("ui.loading.agent.settings"))
    try {
      const [nextSchema, nextConfig, nextRaw] = await Promise.all([
        agentSettings.schema(scope),
        agentSettings.config(scope),
        agentSettings.raw(scope),
      ])
      const [options, endpoints, savedLists] = await Promise.allSettled([
        models.options(scope, { refresh: false, includeUnconfigured: false }),
        models.endpoints(scope),
        models.loadLists(scope, storagePath),
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
      if (request !== loadRequestRef.current) return false
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
      setLoaded(true)
      return true
    } catch (error) {
      if (request === loadRequestRef.current) setStatus(t("ui.load.failed.arg", describeError(error, language)))
      return false
    }
    finally { if (request === loadRequestRef.current) setBusy(false) }
  }, [connected, profile, storagePath])

  React.useEffect(() => {
    if (!loaded) void load()
    return () => { ++loadRequestRef.current }
  }, [load, loaded])

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
    } catch (error) { setStatus(`${key}：${describeError(error, language)}`); return }
    setBusy(true)
    try {
      const scope = profileScope()
      await agentSettings.saveField(scope, key, value)
      if (key === 'agent.reasoning_effort') {
        const saved = await agentSettings.config(scope)
        if (String(getField(saved, key) ?? '') !== text) {
          throw new Error(language === 'zh-CN' ? '默认思考强度保存后回读不一致' : 'Default reasoning did not match after saving')
        }
      }
      if (await load(key)) {
        setEditingKey(null)
        setStatus(t("ui.arg.saved.some.settings.take.effect.in.a.new.session.or.after.restarting.th", key))
      }
    } catch (error) { setStatus(t("ui.failed.to.save.arg.arg", key, describeError(error, language))) }
    finally { setBusy(false) }
  }

  async function saveYaml() {
    if (!dirtyYaml) return
    if (!window.confirm(t("ui.the.raw.yaml.will.replace.all.of.config.yaml.save.the.complete.content"))) return
    setBusy(true)
    try {
      await agentSettings.saveRaw(profileScope(), yamlDraft, raw?.yaml || '')
      if (await load()) setStatus(t("ui.full.configuration.saved.some.settings.take.effect.in.a.new.session.or.afte"))
    } catch (error) { setStatus(t("ui.save.failed.arg", describeError(error, language))) }
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
      await agentSettings.saveAuxiliary(profileScope(), {
        task, provider: auxProvider, model: auxProvider === 'auto' ? '' : auxModel,
        effort: auxEffort, timeout: auxTimeout ? Number(auxTimeout) : null,
      })
      if (await load()) {
        setEditingTask(null)
        setStatus(language === 'zh-CN' ? '辅助模型配置已保存；新会话或下次调用时生效' : 'Auxiliary model saved; applies to a new session or the next call')
      }
    } catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }

  const entries = Object.entries(schema?.fields || {})
  const query = search.trim().toLowerCase()
  const scoped = entries.filter(([key]) => {
    if (section === 'advanced') return true
    if (section === 'main') return ['agent.reasoning_overrides', 'agent.max_turns', 'model_context_length'].includes(key)
    if (section === 'approval') return key.startsWith('approvals.') || key.startsWith('security.')
    return false
  })
  const visible = scoped.filter(([key, field]) => !query ||
    `${key} ${field.description || ''} ${agentFieldTranslation(language, key)?.label || ''} ${agentFieldTranslation(language, key)?.description || ''}`.toLowerCase().includes(query))
  const auxiliaryTasks = Object.keys(schema?.fields || {}).filter(key => /^auxiliary\.[^.]+\.provider$/.test(key)).map(key => key.split('.')[1])
  return {
    language, t, schema, config, raw, yamlDraft, setYamlDraft,
    drafts, setDrafts, editingKey, setEditingKey, expandedPaths, setExpandedPaths,
    search, setSearch, mode, setMode, section, setSection, providers,
    editingTask, setEditingTask, auxProvider, setAuxProvider, auxModel, setAuxModel,
    auxEffort, setAuxEffort, auxTimeout, setAuxTimeout, busy, status, dirtyYaml,
    canDiscard, reload, editField, cancelEdit, saveField, saveYaml,
    editAuxiliary, saveAuxiliary, visible, query, auxiliaryTasks,
  }
}
