import React from 'react'
import { normalizedEndpoint, VOLCENGINE_PRESETS, type CustomEndpoint, type ModelProvider, type SavedModel } from '../model'

type Props = {
  provider: ModelProvider
  endpoint?: CustomEndpoint
  models: string[]
  modelListKey: string
  savedModel: SavedModel | null
  modelBusy: boolean
  modelListBusy: boolean
  modelListLoading: boolean
  t: (key: string, ...values: unknown[]) => string
  onDeleteProvider: (endpoint: CustomEndpoint) => void
  onSelectModel: (provider: string, model: string) => void
  onSaveModels: (provider: string, models: string[]) => Promise<boolean>
}

export default function ProviderCard({ provider, endpoint, models, modelListKey, savedModel, modelBusy, modelListBusy, modelListLoading, t, onDeleteProvider, onSelectModel, onSaveModels }: Props) {
  const [editingModel, setEditingModel] = React.useState<{ original: string; value: string } | null>(null)
  const [newModelId, setNewModelId] = React.useState<string | null>(null)
  const isDefault = Boolean(savedModel && (savedModel.provider === provider.slug || (savedModel.baseUrl && provider.api_url && normalizedEndpoint(savedModel.baseUrl) === normalizedEndpoint(provider.api_url))))
  const providerPreset = VOLCENGINE_PRESETS.find(preset => normalizedEndpoint(preset.baseUrl) === normalizedEndpoint(endpoint?.base_url || provider.api_url || ''))
  const saveRename = async (original: string) => {
    const replacement = editingModel?.value.trim() || ''
    if (await onSaveModels(modelListKey, models.map(model => model === original ? replacement : model))) setEditingModel(null)
  }
  const saveAddition = async () => {
    if (await onSaveModels(modelListKey, [...models, newModelId?.trim() || ''])) setNewModelId(null)
  }
  return <div className={`provider-card ${isDefault ? 'selected' : ''}`}>
    {isDefault && <span className="saved-badge">{t('ui.current.default')}</span>}
    <div className="provider-card-heading"><strong>{providerPreset ? t(providerPreset.name) : endpoint?.name || provider.name}</strong><small>{models.length} {t('ui.models.count.unit')}</small></div>
    {endpoint && <div className="provider-card-meta"><small>{providerPreset ? t('ui.preset.endpoint.via.custom') : t('ui.custom.endpoint')}：{endpoint.base_url}</small><button type="button" disabled={modelBusy} onClick={() => onDeleteProvider(endpoint)}>{t('ui.delete.provider')}</button></div>}
    {isDefault && savedModel?.baseUrl && <small className="provider-card-endpoint">{savedModel.baseUrl}</small>}
    <div className="provider-model-list"><div className="provider-model-items" role="region" aria-label={`${provider.name} ${t('ui.model.options')}`} tabIndex={0}>{models.map(model => {
      const editing = editingModel?.original === model
      return <div className="provider-model-row" key={model}>
        {editing ? <><input aria-label={t('ui.model.id')} value={editingModel.value} onChange={event => setEditingModel({ original: model, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void saveRename(model); if (event.key === 'Escape') setEditingModel(null) }} />
          <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void saveRename(model)}>{t('ui.save')}</button><button type="button" onClick={() => setEditingModel(null)}>{t('ui.cancel')}</button></>
          : <><button type="button" className={`provider-model-id ${isDefault && savedModel?.model === model ? 'current' : ''}`} title={t('ui.select.as.default.model')} onClick={() => onSelectModel(provider.slug, model)}>{model}</button>
            <button type="button" disabled={isDefault && savedModel?.model === model} onClick={() => setEditingModel({ original: model, value: model })}>{t('ui.edit')}</button></>}
        <button type="button" disabled={modelListBusy || modelListLoading || (isDefault && savedModel?.model === model)} className="provider-model-delete" aria-label={t('ui.delete.model.arg', model)} onClick={() => { void onSaveModels(modelListKey, models.filter(item => item !== model)).then(saved => { if (saved && editing) setEditingModel(null) }) }}>{t('ui.remove')}</button>
      </div>
    })}</div>
      {newModelId !== null ? <div className="provider-model-row provider-model-add-row"><input autoFocus aria-label={t('ui.new.model.id')} value={newModelId} onChange={event => setNewModelId(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void saveAddition(); if (event.key === 'Escape') setNewModelId(null) }} placeholder={t('ui.model.id')} />
        <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void saveAddition()}>{t('ui.save')}</button><button type="button" onClick={() => setNewModelId(null)}>{t('ui.cancel')}</button></div>
        : <button type="button" className="provider-add-model" onClick={() => setNewModelId('')}>{t('ui.add.model')}</button>}
    </div>
  </div>
}
