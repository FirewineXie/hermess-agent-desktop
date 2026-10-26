import { agentFieldTranslation, type Language } from '../../../i18n'
import { getField, type Provider, type Schema } from '../model'

type Props = {
  task: string
  config: Record<string, unknown>
  schema: Schema | null
  providers: Provider[]
  editing: boolean
  provider: string
  model: string
  effort: string
  timeout: string
  busy: boolean
  language: Language
  t: (key: string, ...values: unknown[]) => string
  onEdit: (task: string) => void
  onProviderChange: (value: string) => void
  onModelChange: (value: string) => void
  onEffortChange: (value: string) => void
  onTimeoutChange: (value: string) => void
  onSave: (task: string) => void
  onCancel: () => void
}

export default function AuxiliaryTaskCard({ task, config, schema, providers, editing, provider, model,
  effort, timeout, busy, language, t, onEdit, onProviderChange, onModelChange, onEffortChange,
  onTimeoutChange, onSave, onCancel }: Props) {
  const key = `auxiliary.${task}.provider`
  const current = getField(config, `auxiliary.${task}`) as Record<string, unknown> | undefined
  const title = agentFieldTranslation(language, key)?.label.split(/\s*\/\s*/)[1] || task
  const choice = providers.find(item => item.slug === provider)

  return <div className="auxiliary-card">
    <div className="row"><strong>{title}</strong><button type="button" disabled={busy} onClick={() => onEdit(task)}>{t('ui.edit')}</button></div>
    {editing ? <>
      <label>{language === 'zh-CN' ? '提供商' : 'Provider'}<select value={provider} onChange={event => { onProviderChange(event.target.value); onModelChange('') }}>
        <option value="auto">{language === 'zh-CN' ? '跟随主模型' : 'Follow main model'}</option>
        {provider !== 'auto' && !providers.some(item => item.slug === provider) && <option value={provider}>{provider} ({language === 'zh-CN' ? '当前配置，不能直接引用' : 'Current route, not reusable'})</option>}
        {providers.map(item => <option key={item.slug} value={item.slug}>{item.name} ({item.slug})</option>)}
      </select></label>
      {provider !== 'auto' && <><label>{language === 'zh-CN' ? '模型' : 'Model'}<input value={model} onChange={event => onModelChange(event.target.value)} list={`aux-models-${task}`} /></label><datalist id={`aux-models-${task}`}>{choice?.models.map(item => <option value={item} key={item} />)}</datalist></>}
      {schema?.fields[`auxiliary.${task}.reasoning_effort`] && <label>{language === 'zh-CN' ? '推理强度' : 'Reasoning effort'}<select value={effort} onChange={event => onEffortChange(event.target.value)}><option value="">{language === 'zh-CN' ? '继承默认' : 'Inherit default'}</option>{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      {schema?.fields[`auxiliary.${task}.timeout`] && <label>{language === 'zh-CN' ? '超时（秒）' : 'Timeout (seconds)'}<input type="number" min="1" value={timeout} onChange={event => onTimeoutChange(event.target.value)} /></label>}
      <div className="config-field-actions"><button disabled={busy || (provider !== 'auto' && (!model.trim() || !providers.some(item => item.slug === provider)))} onClick={() => onSave(task)}>{t('ui.save.setting')}</button><button className="config-field-cancel" onClick={onCancel}>{t('ui.cancel')}</button></div>
    </> : <small>{current?.provider && current.provider !== 'auto' ? `${String(current.provider)} · ${String(current.model || '')}` : language === 'zh-CN' ? '跟随主模型' : 'Follow main model'}</small>}
  </div>
}
