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
  discoveryBusy: boolean
  t: (key: string, ...values: unknown[]) => string
  onDeleteProvider: (endpoint: CustomEndpoint) => void
  onEditProvider: (provider: ModelProvider, endpoint?: CustomEndpoint) => void
  onSelectModel: (provider: string, model: string) => void
  onSaveModels: (provider: string, models: string[]) => Promise<boolean>
  onSetDiscovery: (endpoint: CustomEndpoint, enabled: boolean) => void
  onSyncModels: () => void
  onSyncProvider?: (endpoint: CustomEndpoint) => void
}

export default function ProviderCard({ provider, endpoint, models, modelListKey, savedModel, modelBusy, modelListBusy, modelListLoading, discoveryBusy, t, onDeleteProvider, onEditProvider, onSelectModel, onSaveModels, onSetDiscovery, onSyncModels, onSyncProvider }: Props) {
  const [editingModel, setEditingModel] = React.useState<{ original: string; value: string } | null>(null)
  const [newModelId, setNewModelId] = React.useState<string | null>(null)
  const isDefault = Boolean(savedModel && (savedModel.provider === provider.slug || provider.is_current || endpoint?.is_current))
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
    <div className="provider-card-heading"><strong>{providerPreset ? t(providerPreset.name) : endpoint?.name || provider.name}</strong><div className="provider-card-actions"><small>{models.length} {t('ui.models.count.unit')}</small><button type="button" disabled={modelBusy} onClick={() => onEditProvider(provider, endpoint)}>{t('ui.edit.configuration')}</button>{endpoint && onSyncProvider && <button type="button" disabled={modelBusy} onClick={() => onSyncProvider(endpoint)}>⇄ {t('ui.provider.sync.profiles')}</button>}</div></div>
    {endpoint && <div className="provider-card-meta"><small>{providerPreset ? t('ui.preset.endpoint.via.custom') : t('ui.custom.endpoint')}：{endpoint.base_url}</small><button type="button" disabled={modelBusy} onClick={() => onDeleteProvider(endpoint)}>{t('ui.delete.provider')}</button></div>}
    {endpoint && endpoint.source !== 'direct-config' && <div className="provider-card-discovery">
      <label><input type="checkbox" checked={endpoint.discover_models !== false} disabled={modelBusy || modelListBusy || discoveryBusy} onChange={event => onSetDiscovery(endpoint, event.target.checked)} />{t('ui.provider.discover.models')}</label>
      <button type="button" disabled={modelBusy || modelListBusy || modelListLoading || discoveryBusy || endpoint.discover_models === false} onClick={onSyncModels}>{t('ui.provider.sync.models')}</button>
    </div>}
    {isDefault && savedModel?.baseUrl && <small className="provider-card-endpoint">{savedModel.baseUrl}</small>}
    <div className="provider-model-list"><div className="provider-model-items" role="region" aria-label={`${provider.name} ${t('ui.model.options')}`} tabIndex={0}>{models.map(model => {
      const editing = editingModel?.original === model
      return <div className="provider-model-row" key={model}>
        {editing ? <><input aria-label={t('ui.model.id')} value={editingModel.value} onChange={event => setEditingModel({ original: model, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void saveRename(model); if (event.key === 'Escape') setEditingModel(null) }} />
          <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void saveRename(model)}>{t('ui.save')}</button><button type="button" onClick={() => setEditingModel(null)}>{t('ui.cancel')}</button></>
          : <><button type="button" className={`provider-model-id ${isDefault && savedModel?.model === model ? 'current' : ''}`} title={t('ui.select.as.default.model')} onClick={() => onSelectModel(provider.slug, model)}>{model}</button>
            <button type="button" disabled={modelBusy || modelListBusy || modelListLoading} onClick={() => {
              if (isDefault && savedModel?.model === model) onSelectModel(provider.slug, model)
              else setEditingModel({ original: model, value: model })
            }}>{t('ui.edit')}</button></>}
        <button type="button" disabled={modelListBusy || modelListLoading || (isDefault && savedModel?.model === model)} className="provider-model-delete" aria-label={t('ui.delete.model.arg', model)} onClick={() => { void onSaveModels(modelListKey, models.filter(item => item !== model)).then(saved => { if (saved && editing) setEditingModel(null) }) }}>{t('ui.remove')}</button>
      </div>
    })}</div>
      {newModelId !== null ? <div className="provider-model-row provider-model-add-row"><input autoFocus aria-label={t('ui.new.model.id')} value={newModelId} onChange={event => setNewModelId(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void saveAddition(); if (event.key === 'Escape') setNewModelId(null) }} placeholder={t('ui.model.id')} />
        <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void saveAddition()}>{t('ui.save')}</button><button type="button" onClick={() => setNewModelId(null)}>{t('ui.cancel')}</button></div>
        : <button type="button" className="provider-add-model" onClick={() => setNewModelId('')}>{t('ui.add.model')}</button>}
    </div>
  </div>
}
