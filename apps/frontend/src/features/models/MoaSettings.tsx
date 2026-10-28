import React from 'react'
import type { MoaConfig, MoaModelSlot, MoaPreset } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

const emptySlot = (): MoaModelSlot => ({ provider: '', model: '', enabled: true })
const emptyPreset = (): MoaPreset => ({
  enabled: true, aggregator: emptySlot(), aggregator_temperature: 0.2,
  degraded_reference_policy: 'loud', reference_models: [emptySlot()],
  reference_temperature: 0.4, reference_timeout: 120, fanout: 'user_turn',
})

export default function MoaSettings({ connected, profile }: { connected: boolean; profile: string | null }) {
  const { models } = useDesktop()
  const language = useLanguage()
  const [config, setConfig] = React.useState<MoaConfig | null>(null)
  const [selected, setSelected] = React.useState('')
  const [newName, setNewName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')

  const load = React.useCallback(async () => {
    if (!connected || !profile) return
    setBusy(true)
    try {
      const next = await models.moa({ kind: 'profile', profile })
      setConfig(next)
      setSelected(current => next.presets[current] ? current : next.active_preset || next.default_preset || Object.keys(next.presets)[0] || '')
      setStatus(language === 'zh-CN' ? '已读取 MoA 方案' : 'MoA presets loaded')
    } catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }, [connected, profile, models, language])
  React.useEffect(() => { void load() }, [load])

  if (!connected || !profile) return <div className="settings-capability-notice"><strong>{language === 'zh-CN' ? '请先连接运行时并选择 Profile' : 'Connect the runtime and select a Profile first'}</strong></div>
  if (!config) return <div className="settings-capability-notice"><strong>{busy ? (language === 'zh-CN' ? '正在读取 MoA…' : 'Loading MoA…') : (language === 'zh-CN' ? 'MoA 不可用' : 'MoA unavailable')}</strong><p>{status}</p><button onClick={() => void load()}>{language === 'zh-CN' ? '重试' : 'Retry'}</button></div>
  const preset = config.presets[selected]
  const updatePreset = (updater: (current: MoaPreset) => MoaPreset) => setConfig(current => current && current.presets[selected]
    ? { ...current, presets: { ...current.presets, [selected]: updater(current.presets[selected]) } } : current)
  const updateSlot = (kind: 'aggregator' | 'reference_models', index: number, patch: Partial<MoaModelSlot>) => updatePreset(current => kind === 'aggregator'
    ? { ...current, aggregator: { ...current.aggregator, ...patch } }
    : { ...current, reference_models: current.reference_models.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot) })
  const save = async () => {
    if (!preset || !preset.aggregator.provider.trim() || !preset.aggregator.model.trim() || !preset.reference_models.length || preset.reference_models.some(slot => !slot.provider.trim() || !slot.model.trim())) {
      setStatus(language === 'zh-CN' ? '聚合模型和每个参考模型都必须填写提供商与模型。' : 'Aggregator and every reference slot require both provider and model.')
      return
    }
    setBusy(true)
    try {
      const active = config.presets[config.active_preset] || preset
      const payload: MoaConfig = { ...config, ...active }
      const saved = await models.saveMoa({ kind: 'profile', profile }, payload)
      setConfig(saved)
      setStatus(language === 'zh-CN' ? 'MoA 方案已保存并重新读取' : 'MoA presets saved and reloaded')
    } catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }
  const addPreset = () => {
    const name = newName.trim()
    if (!name || config.presets[name]) return
    const seed = preset ? structuredClone(preset) : emptyPreset()
    setConfig({ ...config, presets: { ...config.presets, [name]: seed } })
    setSelected(name)
    setNewName('')
  }
  const deletePreset = () => {
    if (Object.keys(config.presets).length <= 1) return
    const presets = { ...config.presets }
    delete presets[selected]
    const fallback = Object.keys(presets)[0]
    setConfig({ ...config, presets, active_preset: config.active_preset === selected ? fallback : config.active_preset, default_preset: config.default_preset === selected ? fallback : config.default_preset })
    setSelected(fallback)
  }
  return <div className="moa-settings">
    <div className="row moa-heading"><div><h2>{language === 'zh-CN' ? 'MoA 多模型方案' : 'Mixture-of-Agents presets'}</h2><p>{language === 'zh-CN' ? '参考模型并行生成候选，聚合模型汇总最终答案。配置按当前 Profile 保存。' : 'Reference models produce candidates in parallel; the aggregator produces the final response.'}</p></div><button disabled={busy} onClick={() => void load()}>{language === 'zh-CN' ? '重新读取' : 'Reload'}</button></div>
    <div className="moa-preset-bar"><label>{language === 'zh-CN' ? '当前方案' : 'Preset'}<select value={selected} onChange={event => setSelected(event.target.value)}>{Object.keys(config.presets).map(name => <option key={name}>{name}</option>)}</select></label><label>{language === 'zh-CN' ? '新方案名称' : 'New preset'}<input value={newName} onChange={event => setNewName(event.target.value)} /></label><button disabled={!newName.trim() || Boolean(config.presets[newName.trim()])} onClick={addPreset}>{language === 'zh-CN' ? '新增' : 'Add'}</button><button className="danger-action" disabled={Object.keys(config.presets).length <= 1} onClick={deletePreset}>{language === 'zh-CN' ? '删除方案' : 'Delete preset'}</button></div>
    {preset && <>
      <div className="moa-flags"><label><input type="checkbox" checked={preset.enabled} onChange={event => updatePreset(current => ({ ...current, enabled: event.target.checked }))} />{language === 'zh-CN' ? '启用此方案' : 'Enable preset'}</label><label><input type="radio" checked={config.default_preset === selected} onChange={() => setConfig({ ...config, default_preset: selected })} />{language === 'zh-CN' ? '默认方案' : 'Default preset'}</label><label><input type="radio" checked={config.active_preset === selected} onChange={() => setConfig({ ...config, active_preset: selected })} />{language === 'zh-CN' ? '当前启用方案' : 'Active preset'}</label></div>
      <section className="moa-card"><h3>{language === 'zh-CN' ? '聚合模型' : 'Aggregator'}</h3><div className="moa-slot"><input aria-label={language === 'zh-CN' ? '聚合提供商' : 'Aggregator provider'} placeholder={language === 'zh-CN' ? '提供商' : 'Provider'} value={preset.aggregator.provider} onChange={event => updateSlot('aggregator', 0, { provider: event.target.value })} /><input aria-label={language === 'zh-CN' ? '聚合模型' : 'Aggregator model'} placeholder={language === 'zh-CN' ? '模型 ID' : 'Model ID'} value={preset.aggregator.model} onChange={event => updateSlot('aggregator', 0, { model: event.target.value })} /></div><label>{language === 'zh-CN' ? '温度' : 'Temperature'}<input type="number" step="0.1" min="0" max="2" value={preset.aggregator_temperature} onChange={event => updatePreset(current => ({ ...current, aggregator_temperature: Number(event.target.value) }))} /></label></section>
      <section className="moa-card"><div className="row"><h3>{language === 'zh-CN' ? '参考模型' : 'Reference models'}</h3><button onClick={() => updatePreset(current => ({ ...current, reference_models: [...current.reference_models, emptySlot()] }))}>{language === 'zh-CN' ? '添加参考模型' : 'Add reference'}</button></div>{preset.reference_models.map((slot, index) => <div className="moa-slot" key={index}><input aria-label={`${language === 'zh-CN' ? '参考提供商' : 'Reference provider'} ${index + 1}`} placeholder={language === 'zh-CN' ? '提供商' : 'Provider'} value={slot.provider} onChange={event => updateSlot('reference_models', index, { provider: event.target.value })} /><input aria-label={`${language === 'zh-CN' ? '参考模型' : 'Reference model'} ${index + 1}`} placeholder={language === 'zh-CN' ? '模型 ID' : 'Model ID'} value={slot.model} onChange={event => updateSlot('reference_models', index, { model: event.target.value })} /><label><input type="checkbox" checked={slot.enabled !== false} onChange={event => updateSlot('reference_models', index, { enabled: event.target.checked })} />{language === 'zh-CN' ? '启用' : 'Enabled'}</label><button className="danger-action" disabled={preset.reference_models.length <= 1} onClick={() => updatePreset(current => ({ ...current, reference_models: current.reference_models.filter((_, slotIndex) => slotIndex !== index) }))}>{language === 'zh-CN' ? '移除' : 'Remove'}</button></div>)}<div className="moa-options"><label>{language === 'zh-CN' ? '参考温度' : 'Reference temperature'}<input type="number" step="0.1" min="0" max="2" value={preset.reference_temperature} onChange={event => updatePreset(current => ({ ...current, reference_temperature: Number(event.target.value) }))} /></label><label>{language === 'zh-CN' ? '超时（秒）' : 'Timeout (seconds)'}<input type="number" min="1" value={preset.reference_timeout ?? ''} onChange={event => updatePreset(current => ({ ...current, reference_timeout: event.target.value ? Number(event.target.value) : null }))} /></label><label>{language === 'zh-CN' ? '降级策略' : 'Degraded policy'}<select value={preset.degraded_reference_policy} onChange={event => updatePreset(current => ({ ...current, degraded_reference_policy: event.target.value as 'loud' | 'silent' }))}><option value="loud">loud</option><option value="silent">silent</option></select></label><label>{language === 'zh-CN' ? '扇出节奏' : 'Fan-out cadence'}<input value={preset.fanout || ''} onChange={event => updatePreset(current => ({ ...current, fanout: event.target.value }))} /></label></div></section>
      <div className="actions"><button disabled={busy} onClick={() => void save()}>{language === 'zh-CN' ? '保存 MoA 方案' : 'Save MoA presets'}</button></div>
    </>}
    <p role="status">{status}</p>
  </div>
}
