import React from 'react'
import type { MoaConfig, MoaModelSlot, MoaPreset, ModelProvider } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { changeMoaSlotProvider, emptyMoaPreset, emptyMoaSlot, moaPayload, moaValidationError, resolveMoaSlot, selectableMoaProviders } from './moaModel'

type Props = {
  connected: boolean
  profile: string | null
  language: Language
  providers: ModelProvider[]
  onOpenProviders: () => void
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}

const efforts = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

function SlotEditor({ slot, id, providers, language, onChange, removable, onRemove }: {
  slot: MoaModelSlot
  id: string
  providers: ModelProvider[]
  language: Language
  onChange(patch: Partial<MoaModelSlot>): void
  removable?: boolean
  onRemove?(): void
}) {
  const zh = language === 'zh-CN'
  const resolvedSlot = resolveMoaSlot(slot, providers)
  const provider = providers.find(item => item.slug === resolvedSlot.provider)
  const effortOptions = efforts.includes(slot.reasoning_effort || '') ? efforts : [slot.reasoning_effort || '', ...efforts]
  return <div className="moa-slot">
    <label>{zh ? '提供商' : 'Provider'}<select value={resolvedSlot.provider} onChange={event => onChange(changeMoaSlotProvider(slot, event.target.value, providers))}>
      <option value="">{zh ? '选择提供商' : 'Select provider'}</option>
      {providers.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
    </select></label>
    <label>{zh ? '模型 ID' : 'Model ID'}<select value={resolvedSlot.model} disabled={!provider} onChange={event => onChange({ model: event.target.value })}>
      <option value="">{zh ? '选择模型' : 'Select model'}</option>
      {(provider?.models || []).map(model => <option key={model} value={model}>{model}</option>)}
    </select></label>
    <label>{zh ? '推理强度' : 'Reasoning effort'}<select value={slot.reasoning_effort || ''} onChange={event => onChange({ reasoning_effort: event.target.value || undefined })}>{effortOptions.map(value => <option key={value} value={value}>{value || (zh ? '继承主模型' : 'Inherit main model')}</option>)}</select></label>
    <label className="moa-check"><input type="checkbox" checked={slot.enabled !== false} onChange={event => onChange({ enabled: event.target.checked })} />{zh ? '启用' : 'Enabled'}</label>
    {removable && <button type="button" className="danger-action" onClick={onRemove}>{zh ? '移除' : 'Remove'}</button>}
  </div>
}

export default function MoaSettings({ connected, profile, language, providers: allProviders, onOpenProviders, onDirtyChange, onBusyChange }: Props) {
  const { models } = useDesktop()
  const zh = language === 'zh-CN'
  const providers = selectableMoaProviders(allProviders)
  const [config, setConfig] = React.useState<MoaConfig | null>(null)
  const [loaded, setLoaded] = React.useState('')
  const [selected, setSelected] = React.useState('')
  const [newName, setNewName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const request = React.useRef(0)
  const dirty = Boolean(config && loaded && JSON.stringify(config) !== loaded)
  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])

  const load = React.useCallback(async () => {
    const version = ++request.current
    if (!connected || !profile) { setConfig(null); setLoaded(''); return }
    setBusy(true); setStatus('')
    try {
      const scope = { kind: 'profile' as const, profile }
      const configResult = await models.moa(scope)
      if (version !== request.current) return
      const next = configResult
      setConfig(next); setLoaded(JSON.stringify(next))
      setSelected(current => next.presets[current] ? current : next.active_preset || next.default_preset || Object.keys(next.presets)[0] || '')
      setStatus(zh ? '已从运行时读取 MoA 配置。' : 'MoA configuration loaded from the runtime.')
    } catch (cause) { if (version === request.current) setStatus(describeError(cause, language)) }
    finally { if (version === request.current) setBusy(false) }
  }, [connected, profile, models, language, zh])
  React.useEffect(() => { void load(); return () => { ++request.current } }, [load])

  if (!connected || !profile) return <div className="memory-settings-state" role="status">{zh ? '连接运行时并选择 Profile 后可编辑。' : 'Connect the runtime and select a Profile.'}</div>
  if (!config) return <div className="memory-settings-state" role={status ? 'alert' : 'status'}><p>{status || (zh ? '正在读取 MoA 配置…' : 'Loading MoA configuration…')}</p><button type="button" disabled={busy} onClick={() => void load()}>{zh ? '重试' : 'Retry'}</button></div>
  const preset = config.presets[selected]
  const updatePreset = (update: (current: MoaPreset) => MoaPreset) => setConfig(current => current?.presets[selected]
    ? { ...current, presets: { ...current.presets, [selected]: update(current.presets[selected]) } } : current)
  const updateSlot = (kind: 'aggregator' | 'reference_models', index: number, patch: Partial<MoaModelSlot>) => updatePreset(current => kind === 'aggregator'
    ? { ...current, aggregator: { ...current.aggregator, ...patch } }
    : { ...current, reference_models: current.reference_models.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot) })
  const save = async () => {
    const issue = moaValidationError(config)
    if (issue) { setStatus(zh ? `MoA 配置无效：${issue}` : `Invalid MoA configuration: ${issue}`); return }
    const version = ++request.current
    setBusy(true); setStatus('')
    try {
      const scope = { kind: 'profile' as const, profile }
      await models.saveMoa(scope, moaPayload(config))
      const verified = await models.moa(scope)
      if (version !== request.current) return
      setConfig(verified); setLoaded(JSON.stringify(verified))
      setSelected(current => verified.presets[current] ? current : verified.active_preset)
      setStatus(zh ? 'MoA 配置已保存并从运行时重新读取。' : 'MoA configuration saved and reloaded from the runtime.')
    } catch (cause) { if (version === request.current) setStatus(describeError(cause, language)) }
    finally { if (version === request.current) setBusy(false) }
  }
  const addPreset = () => {
    const name = newName.trim()
    if (!name || name.length > 128 || config.presets[name]) return
    const seed = preset ? structuredClone(preset) : emptyMoaPreset(providers)
    setConfig({ ...config, presets: { ...config.presets, [name]: seed } }); setSelected(name); setNewName('')
  }
  const deletePreset = () => {
    if (!preset || Object.keys(config.presets).length <= 1) return
    const presets = { ...config.presets }; delete presets[selected]
    const fallback = Object.keys(presets)[0]
    setConfig({ ...config, presets, active_preset: config.active_preset === selected ? fallback : config.active_preset, default_preset: config.default_preset === selected ? fallback : config.default_preset })
    setSelected(fallback)
  }
  return <section className="moa-settings">
    <div className="memory-settings-heading"><div><h2>{zh ? 'MoA 多模型方案' : 'Mixture-of-Agents presets'}</h2><p>{zh ? '参考模型并行生成候选，聚合模型汇总最终答案。提供商和模型来自当前 Profile 的模型设置。' : 'Reference models produce candidates in parallel and the aggregator creates the final answer. Providers and models come from the current Profile settings.'}</p></div><div className="moa-heading-actions"><button type="button" onClick={onOpenProviders}>{zh ? '管理提供商' : 'Manage providers'}</button><button type="button" disabled={busy} onClick={() => void load()}>{zh ? '重新读取' : 'Reload'}</button></div></div>
    {providers.length === 0 && <div className="memory-settings-state" role="status">{zh ? '当前 Profile 没有可用于 MoA 的提供商，请先添加提供商和模型。' : 'This Profile has no providers available for MoA. Add a provider and models first.'}</div>}
    <div className="moa-preset-bar"><label>{zh ? '编辑方案' : 'Preset'}<select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>{Object.keys(config.presets).map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>{zh ? '新方案名称' : 'New preset'}<input value={newName} maxLength={128} onChange={event => setNewName(event.target.value)} /></label><button type="button" disabled={!newName.trim() || Boolean(config.presets[newName.trim()])} onClick={addPreset}>{zh ? '复制为新方案' : 'Copy as new preset'}</button><button type="button" className="danger-action" disabled={Object.keys(config.presets).length <= 1} onClick={deletePreset}>{zh ? '删除方案' : 'Delete preset'}</button></div>
    {preset && <>
      <div className="moa-flags"><label><input type="checkbox" checked={preset.enabled} onChange={event => updatePreset(current => ({ ...current, enabled: event.target.checked }))} />{zh ? '启用此方案' : 'Enable preset'}</label><label><input type="radio" name="moa-default" checked={config.default_preset === selected} onChange={() => setConfig({ ...config, default_preset: selected })} />{zh ? '设为默认方案' : 'Default preset'}</label><label><input type="checkbox" checked={config.active_preset === selected} onChange={event => setConfig({ ...config, active_preset: event.target.checked ? selected : '' })} />{zh ? '常驻使用此方案' : 'Keep this preset active'}</label></div>
      <section className="moa-card"><h3>{zh ? '聚合模型' : 'Aggregator'}</h3><SlotEditor slot={preset.aggregator} id="aggregator" providers={providers} language={language} onChange={patch => updateSlot('aggregator', 0, patch)} /><label>{zh ? '聚合温度' : 'Aggregator temperature'}<input type="number" min="0" max="2" step="0.1" placeholder={zh ? '提供商默认' : 'Provider default'} value={preset.aggregator_temperature ?? ''} onChange={event => updatePreset(current => ({ ...current, aggregator_temperature: event.target.value === '' ? null : Number(event.target.value) }))} /></label></section>
      <section className="moa-card"><div className="moa-card-heading"><h3>{zh ? '参考模型' : 'Reference models'}</h3><button type="button" disabled={preset.reference_models.length >= 32 || providers.length === 0} onClick={() => updatePreset(current => ({ ...current, reference_models: [...current.reference_models, emptyMoaSlot(providers)] }))}>{zh ? '添加参考模型' : 'Add reference'}</button></div>{preset.reference_models.map((slot, index) => <SlotEditor key={index} slot={slot} id={`reference-${index}`} providers={providers} language={language} onChange={patch => updateSlot('reference_models', index, patch)} removable={preset.reference_models.length > 1} onRemove={() => updatePreset(current => ({ ...current, reference_models: current.reference_models.filter((_, item) => item !== index) }))} />)}
        <div className="moa-options"><label>{zh ? '参考温度' : 'Reference temperature'}<input type="number" min="0" max="2" step="0.1" placeholder={zh ? '提供商默认' : 'Provider default'} value={preset.reference_temperature ?? ''} onChange={event => updatePreset(current => ({ ...current, reference_temperature: event.target.value === '' ? null : Number(event.target.value) }))} /></label><label>{zh ? '超时（秒）' : 'Timeout (seconds)'}<input type="number" min="0.1" step="0.1" placeholder={zh ? '继承运行时默认值' : 'Inherit runtime default'} value={preset.reference_timeout ?? ''} onChange={event => updatePreset(current => ({ ...current, reference_timeout: event.target.value ? Number(event.target.value) : null }))} /></label><label>{zh ? '参考失败策略' : 'Degraded policy'}<select value={preset.degraded_reference_policy} onChange={event => updatePreset(current => ({ ...current, degraded_reference_policy: event.target.value as 'loud' | 'silent' }))}><option value="loud">loud</option><option value="silent">silent</option></select></label><label>{zh ? '扇出节奏' : 'Fan-out cadence'}<input list="moa-fanout-options" maxLength={64} value={preset.fanout || ''} onChange={event => updatePreset(current => ({ ...current, fanout: event.target.value }))} /><datalist id="moa-fanout-options"><option value="user_turn" /><option value="per_iteration" /><option value="every_n:2" /></datalist></label></div>
      </section>
      <div className="actions"><button type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存 MoA 配置' : 'Save MoA configuration')}</button></div>
    </>}
    {status && <p className="memory-settings-status" role="status">{status}</p>}
  </section>
}
