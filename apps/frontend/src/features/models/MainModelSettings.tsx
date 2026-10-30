import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { localizeAppMessage } from '../../i18n'
import { getField, type Schema } from '../agent-settings/model'
import { endpointForProvider } from './model'
import { VOLCENGINE_PRESETS } from './model'
import type { useModelController } from './useModelController'

type Props = {
  connected: boolean
  profile: string | null
  epoch: string | null
  language: 'zh-CN' | 'en-US'
  controller: ReturnType<typeof useModelController>
  onOpenProviders: () => void
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}

const serviceTierText: Record<string, { zh: string; en: string; zhHelp: string; enHelp: string }> = {
  '': { zh: '默认（不指定加速）', en: 'Default (no speed override)', zhHelp: '不额外指定快速模式，按运行时默认方式请求。', enHelp: 'Use the runtime default without a fast-mode override.' },
  normal: { zh: '普通模式（normal）', en: 'Normal', zhHelp: '每次请求都使用普通模式。', enHelp: 'Use the normal mode for every request.' },
  fast: { zh: '始终尝试加速（fast）', en: 'Always try fast', zhHelp: '每次请求都尝试使用提供商的快速通道。', enHelp: 'Try the provider fast mode on every request.' },
  auto: { zh: '每轮开始短时加速（auto）', en: 'Fast at the start of each turn', zhHelp: '每轮对话开始后的短时间内尝试使用快速通道。', enHelp: 'Try fast mode for a short window at the start of each turn.' },
  cold: { zh: '仅会话首轮加速（cold）', en: 'Fast on the first turn only', zhHelp: '仅在会话首次提问后的短时间内尝试使用快速通道。', enHelp: 'Try fast mode for a short window after the first prompt in a session.' },
}

export default function MainModelSettings({ connected, profile, epoch, language, controller, onOpenProviders, onDirtyChange, onBusyChange }: Props) {
  const { agentSettings } = useDesktop()
  const { providerCards, customEndpoints, visibleModels, savedModel, modelOptionsLoaded, modelOptionsError, modelBusy, modelStatus, loadModelOptions, saveProviderDefault } = controller
  const zh = language === 'zh-CN'
  const [provider, setProvider] = React.useState('')
  const [model, setModel] = React.useState('')
  const [schema, setSchema] = React.useState<Schema | null>(null)
  const [contextLength, setContextLength] = React.useState('')
  const [reasoning, setReasoning] = React.useState('')
  const [serviceTier, setServiceTier] = React.useState('')
  const [loadedFields, setLoadedFields] = React.useState({ contextLength: '', reasoning: '', serviceTier: '' })
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const request = React.useRef(0)
  const loadFields = React.useCallback(async (): Promise<boolean> => {
    if (!connected || !profile) return false
    const current = ++request.current
    setSchema(null)
    try {
      const scope = { kind: 'profile' as const, profile }
      const [nextSchema, config] = await Promise.all([agentSettings.schema(scope), agentSettings.config(scope)])
      if (current !== request.current) return false
      const values = {
        contextLength: String(getField(config, 'model_context_length') ?? ''),
        reasoning: String(getField(config, 'agent.reasoning_effort') ?? ''),
        serviceTier: String(getField(config, 'agent.service_tier') ?? ''),
      }
      setSchema(nextSchema); setLoadedFields(values)
      setContextLength(values.contextLength); setReasoning(values.reasoning); setServiceTier(values.serviceTier)
      return true
    } catch (cause) { if (current === request.current) setStatus(describeError(cause, language)); return false }
  }, [agentSettings, connected, profile, epoch, language])
  React.useEffect(() => { void loadFields(); return () => { ++request.current } }, [loadFields])
  const initialProvider = providerCards.find(item => item.slug === savedModel?.provider)?.slug
    || providerCards.find(item => item.is_current)?.slug || savedModel?.provider || ''
  React.useEffect(() => {
    if (!modelOptionsLoaded) return
    setProvider(initialProvider)
    setModel(savedModel?.model || '')
    setConfirm(false)
  }, [profile, modelOptionsLoaded, savedModel?.provider, savedModel?.model, initialProvider])
  const dirty = modelOptionsLoaded && (provider !== initialProvider || model !== (savedModel?.model || ''))
    || contextLength !== loadedFields.contextLength || reasoning !== loadedFields.reasoning || serviceTier !== loadedFields.serviceTier
  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy || modelBusy); return () => onBusyChange(false) }, [busy, modelBusy, onBusyChange])
  const selected = providerCards.find(item => item.slug === provider)
  const endpoint = selected ? endpointForProvider(selected, customEndpoints) : undefined
  const baseUrl = endpoint?.base_url || selected?.api_url || (provider === savedModel?.provider ? savedModel?.baseUrl : '') || ''
  const save = async (confirmed: boolean) => {
    if (!profile || !provider.trim() || !model.trim() || busy || modelBusy) return
    if (schema?.fields.model_context_length && contextLength && (!Number.isInteger(Number(contextLength)) || Number(contextLength) < 0)) {
      setStatus(zh ? '上下文长度必须是非负整数（0 为自动）' : 'Context length must be a nonnegative integer (0 = auto)'); return
    }
    setBusy(true); setStatus('')
    try {
      const scope = { kind: 'profile' as const, profile }
      if (provider !== initialProvider || model !== savedModel?.model) {
        const effectiveProvider = VOLCENGINE_PRESETS.some(item => item.id === provider) ? 'custom' : provider
        const result = await saveProviderDefault(effectiveProvider, model, baseUrl, confirmed)
        setConfirm(result === 'confirm')
        if (result === 'confirm') return
        if (result !== 'saved') { setStatus(result === 'unverified' ? (zh ? '主模型已提交，但回读未能确认。请重新读取。' : 'Main model submitted but could not be verified. Reload.') : (zh ? '主模型保存失败' : 'Failed to save main model')); return }
      }
      const changes: Array<[string, unknown]> = []
      if (schema?.fields.model_context_length && contextLength !== loadedFields.contextLength) changes.push(['model_context_length', contextLength ? Number(contextLength) : 0])
      if (schema?.fields['agent.reasoning_effort'] && reasoning !== loadedFields.reasoning) changes.push(['agent.reasoning_effort', reasoning])
      if (schema?.fields['agent.service_tier'] && serviceTier !== loadedFields.serviceTier) changes.push(['agent.service_tier', serviceTier])
      const failed: string[] = []
      for (const [key, value] of changes) {
        try { await agentSettings.saveField(scope, key, value) }
        catch (cause) { failed.push(`${key}: ${describeError(cause, language)}`) }
      }
      const verifiedConfig = await agentSettings.config(scope)
      for (const [key, value] of changes) {
        if (failed.some(item => item.startsWith(`${key}:`))) continue
        if (String(getField(verifiedConfig, key) ?? '') !== String(value ?? '')) failed.push(`${key}: ${zh ? '回读不一致' : 'Readback mismatch'}`)
      }
      await loadModelOptions()
      const fieldsLoaded = await loadFields()
      if (failed.length) setStatus(`${zh ? '部分字段保存失败' : 'Some fields failed'}: ${failed.join('；')}`)
      else if (fieldsLoaded) setStatus(zh ? '主模型配置已保存并重新读取。新会话使用此配置。' : 'Main model saved and reloaded. New chats use this configuration.')
      setConfirm(false)
    } catch (cause) { setStatus(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  return <section className="main-model-settings" aria-label={zh ? '主模型配置' : 'Main model settings'}>
    <h2>{zh ? 'Profile 主模型' : 'Profile main model'}</h2>
    <p>{zh ? '新会话使用此默认模型；已有会话的显式选择不会被覆盖。' : 'New chats use this default. Explicit picks in existing chats remain unchanged.'}</p>
    {!connected || !profile ? <p role="status">{zh ? '连接运行时并选择 Profile 后可编辑。' : 'Connect the runtime and select a Profile.'}</p> : !modelOptionsLoaded ? <p role={modelOptionsError ? 'alert' : 'status'}>{modelOptionsError || (zh ? '正在读取模型…' : 'Loading models…')}</p> : <>
      <p>{zh ? '当前主模型' : 'Current main model'}：<strong>{savedModel?.model ? `${savedModel.provider} · ${savedModel.model}` : (zh ? '未设置' : 'Not set')}</strong></p>
      {providerCards.length === 0 ? <p>{zh ? '尚未配置提供商。' : 'No providers configured.'} <button type="button" onClick={onOpenProviders}>{zh ? '配置提供商' : 'Configure providers'}</button></p> : <form onSubmit={event => { event.preventDefault(); void save(false) }}>
        <label>{zh ? '提供商' : 'Provider'}<select value={provider} disabled={busy || modelBusy} onChange={event => { setProvider(event.target.value); setModel(''); setConfirm(false) }}><option value="">{zh ? '选择提供商' : 'Select provider'}</option>{providerCards.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        <label>{zh ? '模型 ID' : 'Model ID'}<input list="main-model-candidates" value={model} disabled={busy || modelBusy || !provider} onChange={event => { setModel(event.target.value); setConfirm(false) }} /><datalist id="main-model-candidates">{visibleModels(provider).map(item => <option key={item} value={item} />)}</datalist></label>
        {schema?.fields.model_context_length && <label>{zh ? '上下文长度（0 为自动）' : 'Context length (0 = auto)'}<input type="number" min="0" step="1" value={contextLength} onChange={event => setContextLength(event.target.value)} /></label>}
        {schema?.fields['agent.reasoning_effort'] && <label>{zh ? '默认推理强度' : 'Default reasoning effort'}<select value={reasoning} onChange={event => setReasoning(event.target.value)}><option value="">{zh ? '由运行时决定' : 'Runtime default'}</option>{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(item => <option key={item} value={item}>{item}</option>)}</select></label>}
        {schema?.fields['agent.service_tier'] && <label>{zh ? '模型请求速度' : 'Model request speed'}
          <select value={serviceTier} aria-describedby="model-service-tier-help" onChange={event => setServiceTier(event.target.value)}>
            {(schema.fields['agent.service_tier'].options || ['', 'normal', 'fast', 'auto', 'cold']).map(item => {
              const value = String(item)
              return <option key={value} value={value}>{serviceTierText[value]?.[zh ? 'zh' : 'en'] || value}</option>
            })}
          </select>
          <span className="model-service-tier-help" id="model-service-tier-help">
            {serviceTierText[serviceTier]?.[zh ? 'zhHelp' : 'enHelp'] || (zh ? '此选项由运行时和提供商解释。' : 'The runtime and provider interpret this option.')}
            {' '}{zh ? '仅在当前模型与提供商支持时生效。' : 'It takes effect only when the current model and provider support it.'}
          </span>
        </label>}
        <div className="actions"><button type="submit" disabled={busy || modelBusy || !provider || !model.trim()}>{busy || modelBusy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存主模型' : 'Save main model')}</button><button type="button" onClick={() => { void loadModelOptions(); void loadFields() }}>{zh ? '重新读取' : 'Reload'}</button></div>
        {confirm && <div role="alert"><p>{localizeAppMessage(language, modelStatus)}</p><button type="button" disabled={busy || modelBusy} onClick={() => void save(true)}>{zh ? '确认使用此模型' : 'Confirm model'}</button></div>}
        {status && <p role="status">{status}</p>}
      </form>}
    </>}
  </section>
}
