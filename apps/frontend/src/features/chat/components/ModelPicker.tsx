import type React from 'react'
import type { ModelProvider } from '@hermess/contracts'

type Props = {
  pickerRef: React.RefObject<HTMLDivElement | null>
  position: React.CSSProperties
  busy: boolean
  error: string
  confirmation: { provider: string; model: string; remember: boolean; token: string; message: string } | null
  providers: ModelProvider[]
  provider: string
  models: string[]
  modelInput: string
  activeModel: { provider: string; model: string } | null
  turnBusy: boolean
  t: (key: string, ...values: unknown[]) => string
  onRefresh: () => void
  onClose: () => void
  onProviderChange: (provider: string) => void
  onModelInputChange: (model: string) => void
  onPick: (provider: string, model: string, remember?: boolean, confirm?: string) => void
  onOpenSettings: () => void
}

export default function ModelPicker({ pickerRef, position, busy, error, confirmation, providers, provider, models, modelInput, activeModel, turnBusy, t, onRefresh, onClose, onProviderChange, onModelInputChange, onPick, onOpenSettings }: Props) {
  return <div ref={pickerRef} className="model-picker" role="dialog" aria-label={t('ui.select.model')} style={position}>
    <div className="model-picker-header"><strong>{t('ui.select.model')}</strong><span><button type="button" title={t('ui.refresh.models')} disabled={busy} onClick={onRefresh}>↻</button><button type="button" title={t('ui.close')} onClick={onClose}>×</button></span></div>
    {error && <p className="model-picker-message" role="alert">{error}</p>}
    {confirmation && <div className="model-picker-confirm" role="alert"><p>{confirmation.message}</p><button disabled={busy} onClick={() => onPick(confirmation.provider, confirmation.model, confirmation.remember, confirmation.token)}>{t('ui.confirm.this.model')}</button></div>}
    {busy && <p className="model-picker-message" role="status">{t('ui.loading.model.options')}</p>}
    {providers.length > 0 && <><label className="model-picker-provider">{t('ui.provider')}<select value={provider} onChange={event => onProviderChange(event.target.value)}>
      {providers.map(row => <option key={row.slug} value={row.slug}>{row.name}</option>)}
    </select></label>
    <div className="model-picker-list">{models.map(model => <button key={model} disabled={busy || turnBusy} onClick={() => onPick(provider, model)}>
      <span>{model}</span>{activeModel?.provider === provider && activeModel.model === model && <small>✓</small>}
    </button>)}{models.length === 0 && <p className="model-picker-message">{t('ui.this.provider.currently.has.no.model.candidates.please.fill.in.the.model.id')}</p>}</div>
    <div className="model-picker-add"><input aria-label={t('ui.add.model.id')} value={modelInput} onChange={event => onModelInputChange(event.target.value)} maxLength={256} placeholder={t('ui.add.model.id.short')} /><button disabled={busy || turnBusy || !modelInput.trim()} onClick={() => onPick(provider, modelInput, true)}>{t('ui.add.model.short')}</button></div></>}
    {!busy && providers.length === 0 && <p className="model-picker-message">{t('ui.no.available.models')}</p>}
    <button className="model-picker-settings" onClick={onOpenSettings}>{t('ui.add.provider.or.configure.model')} →</button>
  </div>
}
