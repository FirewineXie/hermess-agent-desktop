import React from 'react'
import type { CodingProviderDraft, ModelProvider } from '@hermess/contracts'
import { translateApp, type Language } from '../../i18n'
import ProviderPresetOptions from '../models/components/ProviderPresetOptions'
import { VOLCENGINE_PRESETS } from '../models/model'

export default function ProgrammingProviderEditor({ language, providers, draft, mode, busy, error, onChange, onClose, onSave }: {
  language: Language; providers: ModelProvider[]; draft: CodingProviderDraft; mode: 'configuration' | 'models'; busy: boolean; error: string
  onChange: (value: CodingProviderDraft) => void; onClose: () => void; onSave: () => void
}) {
  const zh = language === 'zh-CN'
  const [preset, setPreset] = React.useState('')
  const origin = React.useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  const patch = (value: Partial<CodingProviderDraft>) => onChange({ ...draft, ...value })
  React.useEffect(() => () => { origin.current?.isConnected && origin.current.focus() }, [])
  const choose = (value: string) => {
    setPreset(value)
    const template = VOLCENGINE_PRESETS.find(item => `preset:${item.id}` === value)
    const provider = providers.find(item => item.slug === value)
    patch({ name: template ? translateApp(language, template.name) : provider?.name || '', base_url: template?.baseUrl || provider?.api_url || '', models: [template?.defaultModel || ''] })
  }
  const keyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() }
    if (event.key !== 'Tab') return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(item => item.offsetParent !== null)
    const first = items[0], last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form className="provider-add-form programming-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="programming-provider-title" onKeyDown={keyDown} onSubmit={event => { event.preventDefault(); onSave() }}>
      <div className="row model-editor-heading"><h3 id="programming-provider-title">{mode === 'models' ? `${draft.name} · ${zh ? '编辑模型' : 'Edit models'}` : draft.id ? (zh ? '编辑提供商' : 'Edit provider') : (zh ? '新增模型提供商' : 'Add model provider')}</h3><button type="button" aria-label={zh ? '关闭' : 'Close'} disabled={busy} onClick={onClose}>×</button></div>
      {mode === 'configuration' ? <>
        {!draft.id && <label>{zh ? '提供商模板' : 'Provider preset'}<select autoFocus disabled={busy} value={preset} onChange={event => choose(event.target.value)}><ProviderPresetOptions providers={providers} language={language} t={key => translateApp(language, key)} /></select></label>}
        <label>{zh ? '提供商名称' : 'Provider name'}<input required autoFocus={Boolean(draft.id)} maxLength={80} disabled={busy} value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
        <label>{zh ? 'API 基础地址' : 'API base URL'}<input required type="url" disabled={busy} value={draft.base_url} placeholder="https://api.your-provider.example/v1" onChange={event => patch({ base_url: event.target.value })} /></label>
        {!draft.id && <label>{zh ? '初始模型 ID' : 'Initial model ID'}<input required disabled={busy} value={draft.models[0] || ''} onChange={event => patch({ models: [event.target.value] })} /></label>}
        <label>API Key<input required={!draft.id} type="password" autoComplete="off" disabled={busy} value={draft.api_key || ''} onChange={event => patch({ api_key: event.target.value })} /></label>
        {draft.id && <small>{zh ? '留空保留原密钥。模型在“编辑模型”中管理。' : 'Leave blank to retain the key. Manage models in Edit models.'}</small>}
      </> : <div className="provider-model-list"><div className="provider-model-items">{draft.models.map((model, index) => <div className="provider-model-row" key={index}><input required autoFocus={index === 0} aria-label={`${zh ? '模型 ID' : 'Model ID'} ${index + 1}`} disabled={busy} value={model} onChange={event => patch({ models: draft.models.map((value, i) => i === index ? event.target.value : value) })} /><button type="button" className="provider-model-delete" disabled={busy || draft.models.length <= 1} onClick={() => patch({ models: draft.models.filter((_, i) => i !== index) })}>{zh ? '删除' : 'Delete'}</button></div>)}</div><button type="button" className="provider-add-model" disabled={busy || draft.models.length >= 32} onClick={() => patch({ models: [...draft.models, ''] })}>{zh ? '＋ 添加模型' : '+ Add model'}</button></div>}
      <p className="programming-validation-hint">{zh ? '仅支持 Responses API；保存前验证流式响应与工具调用。' : 'Responses API only. Streaming and tool calls are validated before saving.'}</p>
      {error && <p className="programming-error" role="alert">{error}</p>}
      <div className="actions"><button type="submit" disabled={busy || !draft.models.length}>{busy ? (zh ? '正在验证…' : 'Validating…') : (zh ? '验证并保存' : 'Validate and save')}</button><button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button></div>
    </form>
  </div>
}
