import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateAgentUi } from '../../i18n'
import AuxiliaryTaskCard from './components/AuxiliaryTaskCard'
import { getField, type Provider, type Schema } from './model'

type Fallback = Record<string, unknown> & { provider: string; model: string }
const normalizeFallbacks = (value: unknown): Fallback[] => Array.isArray(value) ? value.map(item => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const row = item as Record<string, unknown>
    return { ...row, provider: String(row.provider ?? ''), model: String(row.model ?? '') }
  }
  if (typeof item === 'string') {
    const slash = item.indexOf('/')
    return slash > 0 ? { provider: item.slice(0, slash), model: item.slice(slash + 1) } : { provider: '', model: item }
  }
  return { provider: '', model: '' }
}) : []

type Props = {
  page: 'fallbacks' | 'auxiliary'
  connected: boolean
  profile: string | null
  epoch: string | null
  storagePath: string
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}

export default function ModelRouteSettings({ page, connected, profile, epoch, storagePath, onDirtyChange, onBusyChange }: Props) {
  const { agentSettings, models } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [schema, setSchema] = React.useState<Schema | null>(null)
  const [config, setConfig] = React.useState<Record<string, unknown>>({})
  const [providers, setProviders] = React.useState<Provider[]>([])
  const [mainProvider, setMainProvider] = React.useState('')
  const [rows, setRows] = React.useState<Fallback[]>([])
  const [originalRows, setOriginalRows] = React.useState<Fallback[]>([])
  const [editingTask, setEditingTask] = React.useState<string | null>(null)
  const [auxProvider, setAuxProvider] = React.useState('auto')
  const [auxModel, setAuxModel] = React.useState('')
  const [auxEffort, setAuxEffort] = React.useState('')
  const [auxTimeout, setAuxTimeout] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const request = React.useRef(0)
  const load = React.useCallback(async () => {
    if (!connected || !profile) return false
    const current = ++request.current
    setBusy(true); setStatus('')
    try {
      const scope = { kind: 'profile' as const, profile }
      const [nextSchema, nextConfig, options, endpoints, lists, main] = await Promise.all([
        agentSettings.schema(scope), agentSettings.config(scope),
        models.options(scope, { refresh: false, includeUnconfigured: false }).catch(() => ({ providers: [] })),
        models.endpoints(scope).catch(() => ({ endpoints: [] })),
        models.loadLists(scope, storagePath).catch(() => null),
        models.savedConfig(scope).catch(() => null),
      ])
      if (current !== request.current) return false
      const choices: Provider[] = options.providers.filter(item => item.authenticated !== false && !['copilot-acp', 'custom'].includes(item.slug))
        .map(item => ({ slug: item.slug, name: item.name, models: item.models || [] }))
      for (const endpoint of endpoints.endpoints) {
        if (endpoint.source === 'direct-config' || choices.some(item => item.slug === endpoint.id)) continue
        choices.push({ slug: endpoint.id, name: endpoint.name, models: endpoint.models?.length ? endpoint.models : [endpoint.model].filter(Boolean) })
      }
      for (const item of choices) if (lists?.[item.slug]) item.models = lists[item.slug]
      const nextRows = normalizeFallbacks(getField(nextConfig, 'fallback_providers'))
      setSchema(nextSchema); setConfig(nextConfig); setProviders(choices)
      setMainProvider(main?.provider || '')
      setRows(nextRows); setOriginalRows(nextRows); setEditingTask(null); setLoaded(true)
      return true
    } catch (cause) { if (current === request.current) setStatus(describeError(cause, language)); return false }
    finally { if (current === request.current) setBusy(false) }
  }, [connected, profile, epoch, storagePath, agentSettings, models, language])
  React.useEffect(() => { void load(); return () => { ++request.current } }, [load])
  const currentAux = editingTask ? getField(config, `auxiliary.${editingTask}`) as Record<string, unknown> | undefined : undefined
  const dirtyAux = Boolean(editingTask && (auxProvider !== String(currentAux?.provider || 'auto') || auxModel !== String(currentAux?.model || '') || auxEffort !== String(currentAux?.reasoning_effort || '') || auxTimeout !== String(currentAux?.timeout ?? '')))
  const dirty = JSON.stringify(rows) !== JSON.stringify(originalRows) || dirtyAux
  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  const saveFallbacks = async () => {
    if (!profile || busy || rows.some(row => !row.provider.trim() || !row.model.trim())) return
    if (new Set(rows.map(row => `${row.provider}\0${row.model}`)).size !== rows.length) { setStatus(zh ? '回退模型不能重复' : 'Duplicate fallback models'); return }
    setBusy(true); setStatus('')
    try {
      const scope = { kind: 'profile' as const, profile }
      await agentSettings.saveField(scope, 'fallback_providers', rows)
      const saved = normalizeFallbacks(getField(await agentSettings.config(scope), 'fallback_providers'))
      if (JSON.stringify(saved) !== JSON.stringify(rows)) throw new Error(zh ? '回退链回读不一致' : 'Fallback chain did not match after saving')
      setRows(saved); setOriginalRows(saved)
      setStatus(zh ? '回退链已保存并回读确认' : 'Fallback chain saved and verified')
    } catch (cause) { setStatus(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const editAuxiliary = (task: string) => {
    if (dirtyAux && !window.confirm(zh ? '放弃未保存的辅助模型修改？' : 'Discard unsaved auxiliary changes?')) return
    const current = getField(config, `auxiliary.${task}`) as Record<string, unknown> | undefined
    setAuxProvider(String(current?.provider || 'auto')); setAuxModel(String(current?.model || ''))
    setAuxEffort(String(current?.reasoning_effort || '')); setAuxTimeout(String(current?.timeout ?? ''))
    setEditingTask(task)
  }
  const saveAuxiliary = async (task: string) => {
    if (!profile || busy) return
    if (auxProvider !== 'auto' && (!auxModel.trim() || !providers.some(item => item.slug === auxProvider))) { setStatus(zh ? '请选择有效提供商并填写模型 ID' : 'Choose a valid provider and model'); return }
    if (auxTimeout && (!Number.isFinite(Number(auxTimeout)) || Number(auxTimeout) <= 0)) { setStatus(zh ? '超时必须是正数' : 'Timeout must be positive'); return }
    setBusy(true); setStatus('')
    try {
      const scope = { kind: 'profile' as const, profile }
      await agentSettings.saveAuxiliary(scope, { task, provider: auxProvider, model: auxProvider === 'auto' ? '' : auxModel.trim(), effort: auxEffort, timeout: auxTimeout ? Number(auxTimeout) : null })
      const nextConfig = await agentSettings.config(scope)
      const saved = getField(nextConfig, `auxiliary.${task}`) as Record<string, unknown> | undefined
      if (String(saved?.provider || 'auto') !== auxProvider
        || (auxProvider !== 'auto' && String(saved?.model || '') !== auxModel.trim())
        || (schema?.fields[`auxiliary.${task}.reasoning_effort`] && String(saved?.reasoning_effort ?? '') !== auxEffort)
        || (auxTimeout && schema?.fields[`auxiliary.${task}.timeout`] && Number(saved?.timeout) !== Number(auxTimeout))) throw new Error(zh ? '辅助模型回读不一致' : 'Auxiliary model did not match after saving')
      setConfig(nextConfig); setEditingTask(null); setStatus(zh ? '辅助模型已保存并回读确认' : 'Auxiliary model saved and verified')
    } catch (cause) { setStatus(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const tasks = Object.keys(schema?.fields || {}).filter(key => /^auxiliary\.[^.]+\.provider$/.test(key)).map(key => key.split('.')[1]).filter(task => task !== 'compression')
  return <section className="model-route-settings">
    <div className="row"><h2>{page === 'fallbacks' ? (zh ? '回退模型' : 'Fallback models') : (zh ? '辅助模型' : 'Auxiliary models')}</h2><button type="button" disabled={busy || dirty} onClick={() => void load()}>{zh ? '重新读取' : 'Reload'}</button></div>
    {!connected || !profile ? <p role="status">{zh ? '连接运行时并选择 Profile 后可编辑。' : 'Connect the runtime and select a Profile.'}</p>
      : !loaded ? <p role={status ? 'alert' : 'status'}>{status || (zh ? '正在读取配置…' : 'Loading configuration…')}</p>
        : page === 'fallbacks' ? !schema?.fields.fallback_providers ? <p role="status">{zh ? '当前运行时不支持回退模型配置。' : 'Fallback settings are unavailable in this runtime.'}</p>
          : <><p>{zh ? '主模型失败时按此顺序尝试。' : 'Tried in this order when the main model fails.'}</p>
            {rows.length === 0 && <p>{zh ? '尚无回退模型。' : 'No fallback models.'}</p>}
            {rows.map((row, index) => <div className="fallback-row" key={index}><span>{index + 1}</span>
              <select aria-label={`${index + 1} ${zh ? '提供商' : 'Provider'}`} value={row.provider} onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, provider: event.target.value, model: '' } : item))}><option value="">{zh ? '选择提供商' : 'Select provider'}</option>{row.provider && !providers.some(item => item.slug === row.provider) && <option value={row.provider}>{row.provider}</option>}{providers.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
              <input aria-label={`${index + 1} ${zh ? '模型 ID' : 'Model ID'}`} list={`fallback-models-${index}`} value={row.model} onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, model: event.target.value } : item))} placeholder={zh ? '模型 ID' : 'Model ID'} /><datalist id={`fallback-models-${index}`}>{providers.find(item => item.slug === row.provider)?.models.map(item => <option key={item} value={item} />)}</datalist>
              <button type="button" disabled={busy || index === 0} aria-label={`${index + 1} ${zh ? '上移' : 'Move up'}`} onClick={() => setRows(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>↑</button>
              <button type="button" disabled={busy || index === rows.length - 1} aria-label={`${index + 1} ${zh ? '下移' : 'Move down'}`} onClick={() => setRows(current => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next })}>↓</button>
              <button type="button" disabled={busy} aria-label={`${index + 1} ${zh ? '移除' : 'Remove'}`} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>×</button>
            </div>)}
            <div className="actions"><button type="button" disabled={busy} onClick={() => setRows(current => [...current, { provider: '', model: '' }])}>{zh ? '添加回退模型' : 'Add fallback'}</button><button type="button" disabled={busy || !dirty || rows.some(row => !row.provider.trim() || !row.model.trim())} onClick={() => void saveFallbacks()}>{zh ? '保存回退链' : 'Save fallback chain'}</button></div>
          </> : tasks.length === 0 ? <p role="status">{zh ? '当前运行时没有可配置的辅助任务。' : 'No configurable auxiliary tasks in this runtime.'}</p>
            : <div className="auxiliary-list"><p>{zh ? '每个任务可跟随主模型，或指定提供商与模型。' : 'Each task can follow the main model or use a fixed provider and model.'}</p>
              {editingTask && auxProvider !== 'auto' && mainProvider && auxProvider !== mainProvider && <p role="status">{zh ? '此任务使用的提供商与主模型不同。' : 'This task uses a different provider from the main model.'}</p>}
              {tasks.map(task => <AuxiliaryTaskCard key={task} task={task} config={config} schema={schema} providers={providers} editing={editingTask === task} provider={auxProvider} model={auxModel} effort={auxEffort} timeout={auxTimeout} busy={busy} language={language} t={key => translateAgentUi(language, key)} onEdit={editAuxiliary} onProviderChange={setAuxProvider} onModelChange={setAuxModel} onEffortChange={setAuxEffort} onTimeoutChange={setAuxTimeout} onSave={value => void saveAuxiliary(value)} onCancel={() => setEditingTask(null)} />)}</div>}
    {status && loaded && <p role="status">{status}</p>}
  </section>
}
