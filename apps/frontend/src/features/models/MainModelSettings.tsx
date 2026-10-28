import React from 'react'
import { localizeAppMessage } from '../../i18n'
import { endpointForProvider } from './model'
import type { useModelController } from './useModelController'
import '../settings/settings-extra.css'

type Props = {
  connected: boolean
  profile: string | null
  language: 'zh-CN' | 'en-US'
  controller: ReturnType<typeof useModelController>
  onOpenProviders: () => void
}

export default function MainModelSettings({ connected, profile, language, controller, onOpenProviders }: Props) {
  const { providerCards, customEndpoints, visibleModels, savedModel, modelOptionsLoaded,
    modelOptionsError, modelBusy, modelStatus, loadModelOptions, saveProviderDefault } = controller
  const [provider, setProvider] = React.useState('')
  const [model, setModel] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const [saveStatus, setSaveStatus] = React.useState('')
  React.useEffect(() => {
    if (!modelOptionsLoaded) return
    setProvider(providerCards.find(item => item.slug === savedModel?.provider)?.slug
      || providerCards.find(item => item.is_current)?.slug || savedModel?.provider || '')
    setModel(savedModel?.model || '')
    setConfirm(false)
    setSaveStatus('')
  }, [profile, modelOptionsLoaded, savedModel?.provider, savedModel?.model])

  const selected = providerCards.find(item => item.slug === provider)
  const endpoint = selected ? endpointForProvider(selected, customEndpoints) : undefined
  const baseUrl = endpoint?.base_url || selected?.api_url || (selected?.is_current ? savedModel?.baseUrl : '') || ''
  const candidates = provider ? visibleModels(provider) : []
  const current = providerCards.find(item => item.slug === savedModel?.provider)
    || providerCards.find(item => item.is_current)
  const currentLabel = current?.name || savedModel?.name || savedModel?.provider || ''
  const save = async (confirmed: boolean) => {
    const result = await saveProviderDefault(provider, model, baseUrl, confirmed)
    setConfirm(result === 'confirm')
    if (result === 'saved') setSaveStatus(language === 'zh-CN' ? '主模型已保存并重新读取；新会话将使用此配置。' : 'Main model saved and reloaded for new chats.')
    if (result === 'unverified') setSaveStatus(language === 'zh-CN' ? '主模型已提交，但重新读取未能核实，请再次读取确认。' : 'Main model submitted, but the reload could not verify it. Reload to confirm.')
  }

  return <section className="main-model-settings" aria-label={language === 'zh-CN' ? '主模型分配' : 'Main model assignment'}>
    <div className="main-model-heading"><div><h2>{language === 'zh-CN' ? 'Profile 主模型' : 'Profile main model'}</h2>
      <p>{language === 'zh-CN' ? '新会话从此设置选取模型；已显式选定模型的会话保持自己的选择。' : 'New chats use this setting. Chats with an explicit model pick keep their choice.'}</p></div>
      <button type="button" disabled={modelBusy} onClick={() => void loadModelOptions()}>{language === 'zh-CN' ? '重新读取' : 'Reload'}</button></div>
    {!connected || !profile ? <p role="status">{language === 'zh-CN' ? '连接运行时后选择 Profile。' : 'Connect the runtime and select a Profile.'}</p>
      : !modelOptionsLoaded ? <p role="status">{modelOptionsError || (language === 'zh-CN' ? '正在读取模型…' : 'Loading models…')}</p>
        : <>
          <p className="main-model-current">{language === 'zh-CN' ? '当前主模型' : 'Current main model'} <strong>{savedModel?.model ? `${currentLabel} · ${savedModel.model}` : (language === 'zh-CN' ? '未设置' : 'Not set')}</strong></p>
          {providerCards.length === 0 ? <p>{language === 'zh-CN' ? '当前 Profile 没有已配置的提供商。' : 'This Profile has no configured providers.'} <button type="button" onClick={onOpenProviders}>{language === 'zh-CN' ? '配置提供商' : 'Configure providers'}</button></p>
            : <form onSubmit={event => { event.preventDefault(); void save(false) }}>
              <label>{language === 'zh-CN' ? '提供商' : 'Provider'}<select value={provider} disabled={modelBusy} onChange={event => { const next = event.target.value; setProvider(next); setModel(visibleModels(next)[0] || ''); setConfirm(false); setSaveStatus('') }}>
                <option value="">{language === 'zh-CN' ? '选择提供商' : 'Select provider'}</option>
                {providerCards.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
              </select></label>
              <label>{language === 'zh-CN' ? '模型 ID' : 'Model ID'}<input list="main-model-candidates" value={model} disabled={modelBusy || !provider} onChange={event => { setModel(event.target.value); setConfirm(false); setSaveStatus('') }} autoComplete="off" />
                <datalist id="main-model-candidates">{candidates.map(item => <option key={item} value={item} />)}</datalist></label>
              <div className="main-model-actions"><button type="submit" disabled={modelBusy || !provider || !model.trim()}>{modelBusy ? (language === 'zh-CN' ? '保存中…' : 'Saving…') : (language === 'zh-CN' ? '保存主模型' : 'Save main model')}</button><button type="button" onClick={onOpenProviders}>{language === 'zh-CN' ? '管理提供商' : 'Manage providers'}</button></div>
              {confirm && <div role="alert" className="main-model-confirm"><p>{localizeAppMessage(language, modelStatus)}</p><button type="button" disabled={modelBusy} onClick={() => void save(true)}>{language === 'zh-CN' ? '确认使用此模型' : 'Confirm this model'}</button></div>}
              {!confirm && modelStatus && <p role="status">{localizeAppMessage(language, modelStatus)}</p>}
              {saveStatus && <p role="status">{saveStatus}</p>}
              {modelOptionsError && <p role="alert">{modelOptionsError}</p>}
            </form>}
        </>}
  </section>
}
