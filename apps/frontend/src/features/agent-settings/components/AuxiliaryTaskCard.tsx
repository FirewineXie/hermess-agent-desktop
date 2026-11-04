import { agentFieldTranslation, type Language } from '../../../i18n'
import { type Provider, type Schema } from '../model'
import type { AuxiliaryTaskAssignment } from '@hermess/contracts'

type Props = {
  assignment: AuxiliaryTaskAssignment
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

export default function AuxiliaryTaskCard({ assignment, schema, providers, editing, provider, model,
  effort, timeout, busy, language, t, onEdit, onProviderChange, onModelChange, onEffortChange,
  onTimeoutChange, onSave, onCancel }: Props) {
  const task = assignment.task
  const key = `auxiliary.${task}.provider`
  const title = assignment.label || agentFieldTranslation(language, key)?.label.split(/\s*\/\s*/)[1] || task
  const choice = providers.find(item => item.slug === provider)
  const followLabel = assignment.inherit_from
    ? (language === 'zh-CN' ? `跟随 ${assignment.inherit_from}` : `Follow ${assignment.inherit_from}`)
    : (language === 'zh-CN' ? '跟随主模型' : 'Follow main model')
  const effective = assignment.effective
    ? `${assignment.effective.provider} · ${assignment.effective.model || (language === 'zh-CN' ? '提供商默认模型' : 'provider default')}`
    : ''

  return <div className="auxiliary-card">
    <div className="row"><strong>{title}</strong><button type="button" disabled={busy} onClick={() => onEdit(task)}>{t('ui.edit')}</button></div>
    {assignment.hint && <small>{assignment.hint}</small>}
    {assignment.plugin && <small>{language === 'zh-CN' ? '插件' : 'Plugin'}: {assignment.plugin}</small>}
    {editing ? <>
      <label>{language === 'zh-CN' ? '提供商' : 'Provider'}<select value={provider} onChange={event => { onProviderChange(event.target.value); onModelChange('') }}>
        <option value="auto">{followLabel}</option>
        {provider !== 'auto' && !providers.some(item => item.slug === provider) && <option value={provider}>{provider} ({language === 'zh-CN' ? '当前配置，不能直接引用' : 'Current route, not reusable'})</option>}
        {providers.map(item => <option key={item.slug} value={item.slug}>{item.name} ({item.slug})</option>)}
      </select></label>
      {provider !== 'auto' && <><label>{language === 'zh-CN' ? '模型' : 'Model'}<input value={model} onChange={event => onModelChange(event.target.value)} list={`aux-models-${task}`} /></label><datalist id={`aux-models-${task}`}>{choice?.models.map(item => <option value={item} key={item} />)}</datalist></>}
      {schema?.fields[`auxiliary.${task}.reasoning_effort`] && <label>{language === 'zh-CN' ? '推理强度' : 'Reasoning effort'}<select value={effort} onChange={event => onEffortChange(event.target.value)}><option value="">{language === 'zh-CN' ? '继承默认' : 'Inherit default'}</option>{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      {schema?.fields[`auxiliary.${task}.timeout`] && <label>{language === 'zh-CN' ? '超时（秒）' : 'Timeout (seconds)'}<input type="number" min="1" value={timeout} onChange={event => onTimeoutChange(event.target.value)} /></label>}
      <div className="config-field-actions"><button disabled={busy || (provider !== 'auto' && (!model.trim() || !providers.some(item => item.slug === provider)))} onClick={() => onSave(task)}>{t('ui.save.setting')}</button><button className="config-field-cancel" onClick={onCancel}>{t('ui.cancel')}</button></div>
    </> : <small>{assignment.provider && assignment.provider !== 'auto'
      ? `${assignment.provider} · ${assignment.model || (language === 'zh-CN' ? '提供商默认模型' : 'provider default')}`
      : effective ? `${followLabel} · ${effective}` : followLabel}</small>}
  </div>
}
