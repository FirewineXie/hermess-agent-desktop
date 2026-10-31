import React from 'react'
import type { AgentConfigSchema } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import AuxiliaryTaskCard from './components/AuxiliaryTaskCard'
import { getField, type Provider } from './model'

type Props = {
  profile: string
  storagePath: string
  config: Record<string, unknown>
  schema: AgentConfigSchema
  language: Language
  disabled: boolean
  onSaved: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}

export default function CompressionRoutePicker({ profile, storagePath, config, schema, language, disabled, onSaved, onDirtyChange, onBusyChange }: Props) {
  const { agentSettings, models } = useDesktop()
  const zh = language === 'zh-CN'
  const current = getField(config, 'auxiliary.compression') as Record<string, unknown> | undefined
  const [providers, setProviders] = React.useState<Provider[]>([])
  const [editing, setEditing] = React.useState(false)
  const [provider, setProvider] = React.useState('auto')
  const [model, setModel] = React.useState('')
  const [effort, setEffort] = React.useState('')
  const [timeout, setTimeoutValue] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const request = React.useRef(0)
  const dirty = editing && (provider !== String(current?.provider || 'auto') || model !== String(current?.model || '')
    || effort !== String(current?.reasoning_effort || '') || timeout !== String(current?.timeout ?? ''))

  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  React.useEffect(() => () => { ++request.current }, [])

  async function edit() {
    if (disabled || busy) return
    if (dirty && !window.confirm(zh ? '放弃尚未保存的压缩模型修改？' : 'Discard unsaved compression model changes?')) return
    const active = ++request.current
    setProvider(String(current?.provider || 'auto'))
    setModel(String(current?.model || ''))
    setEffort(String(current?.reasoning_effort || ''))
    setTimeoutValue(String(current?.timeout ?? ''))
    setStatus('')
    setBusy(true)
    try {
      const scope = { kind: 'profile' as const, profile }
      const options = await models.options(scope, { refresh: false, includeUnconfigured: false })
      const [endpoints, lists] = await Promise.all([
        models.endpoints(scope).catch(() => ({ endpoints: [] })),
        models.loadLists(scope, storagePath).catch(() => null),
      ])
      if (active !== request.current) return
      const choices: Provider[] = options.providers.filter(item => item.authenticated !== false && !['copilot-acp', 'custom'].includes(item.slug))
        .map(item => ({ slug: item.slug, name: item.name, models: item.models || [] }))
      for (const endpoint of endpoints.endpoints) {
        if (endpoint.source === 'direct-config' || choices.some(item => item.slug === endpoint.id)) continue
        choices.push({ slug: endpoint.id, name: endpoint.name, models: endpoint.models?.length ? endpoint.models : [endpoint.model].filter(Boolean) })
      }
      for (const item of choices) if (lists?.[item.slug]) item.models = lists[item.slug]
      setProviders(choices)
      setEditing(true)
    } catch (cause) {
      if (active === request.current) setStatus(describeError(cause, language))
    } finally {
      if (active === request.current) setBusy(false)
    }
  }

  async function save() {
    if (disabled || busy || (provider !== 'auto' && (!model.trim() || !providers.some(item => item.slug === provider)))) return
    if (timeout && (!Number.isFinite(Number(timeout)) || Number(timeout) <= 0)) {
      setStatus(zh ? '超时必须是正数。' : 'Timeout must be positive.')
      return
    }
    if ((current?.base_url || current?.api_key || current?.key_env || current?.api_key_env) && !window.confirm(
      zh ? '选择已有厂商会清除压缩任务单独设置的地址和凭据，改用该厂商的配置。继续吗？'
        : 'Selecting a configured provider clears this task’s separate endpoint and credentials. Continue?',
    )) return
    const active = ++request.current
    const scope = { kind: 'profile' as const, profile }
    setBusy(true)
    setStatus('')
    try {
      await agentSettings.saveAuxiliary(scope, { task: 'compression', provider, model: provider === 'auto' ? '' : model.trim(),
        effort, timeout: timeout ? Number(timeout) : null })
      const saved = getField(await agentSettings.config(scope), 'auxiliary.compression') as Record<string, unknown> | undefined
      if (active !== request.current) return
      if (String(saved?.provider || 'auto') !== provider || String(saved?.model || '') !== (provider === 'auto' ? '' : model.trim())
        || (schema.fields['auxiliary.compression.reasoning_effort'] && String(saved?.reasoning_effort ?? '') !== effort)
        || (timeout && schema.fields['auxiliary.compression.timeout'] && Number(saved?.timeout) !== Number(timeout))) {
        throw new Error(zh ? '压缩模型保存后回读不一致。' : 'The compression route did not match after saving.')
      }
      setEditing(false)
      await onSaved()
      setStatus(zh ? '压缩模型已保存并回读确认。' : 'Compression model saved and verified.')
    } catch (cause) {
      if (active === request.current) setStatus(`${zh ? '保存失败' : 'Save failed'}：${describeError(cause, language)}`)
    } finally {
      if (active === request.current) setBusy(false)
    }
  }

  return <div className="compression-route-picker">
    <AuxiliaryTaskCard task="compression" config={config} schema={schema} providers={providers} editing={editing}
      provider={provider} model={model} effort={effort} timeout={timeout} busy={busy || disabled} language={language}
      t={key => key === 'ui.edit' ? (zh ? '按厂商选择' : 'Choose provider') : key === 'ui.save.setting' ? (zh ? '保存设置' : 'Save setting') : (zh ? '取消' : 'Cancel')}
      onEdit={() => void edit()} onProviderChange={setProvider} onModelChange={setModel} onEffortChange={setEffort}
      onTimeoutChange={setTimeoutValue} onSave={() => void save()} onCancel={() => { ++request.current; setEditing(false); setStatus('') }} />
    {!editing && schema.fields['auxiliary.compression.reasoning_effort'] && <small>{zh ? '推理强度' : 'Reasoning effort'}：{String(current?.reasoning_effort || (zh ? '继承默认' : 'Inherit default'))}</small>}
    {!editing && schema.fields['auxiliary.compression.timeout'] && <small>{zh ? '超时' : 'Timeout'}：{current?.timeout == null || current.timeout === '' ? (zh ? '未设置' : 'Not set') : `${String(current.timeout)} ${zh ? '秒' : 'seconds'}`}</small>}
    {editing && <small>{zh ? '从当前 Profile 已配置的厂商与模型中选择；也可输入该厂商的其他模型 ID。' : 'Choose a configured provider and model for this Profile, or enter another model ID.'}</small>}
    {editing && providers.length === 0 && <small>{zh ? '没有可选厂商。请先在“模型设置”中配置并保存一个厂商。' : 'No providers are available. Configure one in Model settings first.'}</small>}
    {status && <p role="status">{status}</p>}
  </div>
}
