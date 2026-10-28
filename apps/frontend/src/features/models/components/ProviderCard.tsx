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
  onSaveModels: (provider: string, models: string[]) => Promise<boolean>
  onSetDiscovery: (endpoint: CustomEndpoint, enabled: boolean) => void
  onSyncModels: () => void
  onDirtyChange: (key: string, dirty: boolean) => void
}

export default function ProviderCard({ provider, endpoint, models, modelListKey, savedModel, modelBusy, modelListBusy, modelListLoading, discoveryBusy, t, onDeleteProvider, onEditProvider, onSaveModels, onSetDiscovery, onSyncModels, onDirtyChange }: Props) {
  const [editingModel, setEditingModel] = React.useState<{ original: string; value: string } | null>(null)
  const [newModelId, setNewModelId] = React.useState<string | null>(null)
  const [editingModels, setEditingModels] = React.useState(false)
  const editModelsOrigin = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => { onDirtyChange(modelListKey, editingModel !== null || newModelId !== null); return () => onDirtyChange(modelListKey, false) }, [editingModel, newModelId, modelListKey, onDirtyChange])
  const isDefault = Boolean(savedModel && (savedModel.provider === provider.slug || provider.is_current || endpoint?.is_current))
  const providerPreset = VOLCENGINE_PRESETS.find(preset => normalizedEndpoint(preset.baseUrl) === normalizedEndpoint(endpoint?.base_url || provider.api_url || ''))
  const providerName = providerPreset ? t(providerPreset.name) : endpoint?.name || provider.name
  const closeModelEditor = () => {
    setEditingModels(false)
    setEditingModel(null)
    setNewModelId(null)
    requestAnimationFrame(() => editModelsOrigin.current?.isConnected && editModelsOrigin.current.focus())
  }
  const openModelEditor = () => {
    editModelsOrigin.current = document.activeElement as HTMLElement
    setEditingModels(true)
  }
  const modelEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !modelBusy && !modelListBusy && editingModel === null && newModelId === null) { event.stopPropagation(); closeModelEditor(); return }
    if (event.key !== 'Tab') return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
    if (!items.length) return
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus() }
    else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
  }
  const saveRename = async (original: string) => {
    const replacement = editingModel?.value.trim() || ''
    if (await onSaveModels(modelListKey, models.map(model => model === original ? replacement : model))) setEditingModel(null)
  }
  const saveAddition = async () => {
    if (await onSaveModels(modelListKey, [...models, newModelId?.trim() || ''])) setNewModelId(null)
  }
  const modelRow = (model: string) => {
    const editing = editingModel?.original === model
    return <div className="provider-model-row" key={model}>
      {editing ? <><input aria-label={t('ui.model.id')} value={editingModel.value} onChange={event => setEditingModel({ original: model, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void saveRename(model); if (event.key === 'Escape') setEditingModel(null) }} />
        <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void saveRename(model)}>{t('ui.save')}</button><button type="button" onClick={() => setEditingModel(null)}>{t('ui.cancel')}</button></>
        : <><span className={`provider-model-id ${isDefault && savedModel?.model === model ? 'current' : ''}`}>{model}</span>
          <button type="button" disabled={modelBusy || modelListBusy || modelListLoading} onClick={() => setEditingModel({ original: model, value: model })}>{t('ui.edit')}</button></>}
      <button type="button" disabled={modelListBusy || modelListLoading || (isDefault && savedModel?.model === model)} className="provider-model-delete" aria-label={t('ui.delete.model.arg', model)} onClick={() => { void onSaveModels(modelListKey, models.filter(item => item !== model)).then(saved => { if (saved && editing) setEditingModel(null) }) }}>{t('ui.remove')}</button>
    </div>
  }
  return <div className={`provider-card ${isDefault ? 'selected' : ''}`}>
    {isDefault && <span className="saved-badge">{t('ui.current.default')}</span>}
    <div className="provider-card-heading"><strong>{providerName}</strong><div className="provider-card-actions"><small>{models.length} {t('ui.models.count.unit')}</small><button type="button" disabled={modelBusy} aria-haspopup="dialog" onClick={openModelEditor}>{t('ui.edit.models')}</button><button type="button" disabled={modelBusy} onClick={() => onEditProvider(provider, endpoint)}>{t(!endpoint || endpoint.source === 'direct-config' ? 'ui.save.default.model' : 'ui.edit.configuration')}</button></div></div>
    {endpoint && <div className="provider-card-meta"><small>{providerPreset ? t('ui.preset.endpoint.via.custom') : t('ui.custom.endpoint')}：{endpoint.base_url}</small><button type="button" disabled={modelBusy} onClick={() => onDeleteProvider(endpoint)}>{t('ui.delete.provider')}</button></div>}
    {endpoint && endpoint.source !== 'direct-config' && <div className="provider-card-discovery">
      <label><input type="checkbox" checked={endpoint.discover_models !== false} disabled={modelBusy || modelListBusy || discoveryBusy} onChange={event => onSetDiscovery(endpoint, event.target.checked)} />{t('ui.provider.discover.models')}</label>
      <button type="button" disabled={modelBusy || modelListBusy || modelListLoading || discoveryBusy || endpoint.discover_models === false} onClick={onSyncModels}>{t('ui.provider.sync.models')}</button>
    </div>}
    {isDefault && savedModel?.baseUrl && <small className="provider-card-endpoint">{savedModel.baseUrl}</small>}
    <div className="provider-model-preview" aria-label={`${providerName} ${t('ui.model.options')}`}>
      {models.slice(0, 2).map(model => <div className="provider-model-preview-row" key={model}><span className={isDefault && savedModel?.model === model ? 'current' : ''}>{model}</span></div>)}
      {models.length === 0 && <small>{t('ui.no.models.in.provider')}</small>}
    </div>
    {editingModels && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !modelBusy && !modelListBusy) closeModelEditor() }}>
      <div className="provider-add-form provider-model-editor" role="dialog" aria-modal="true" aria-labelledby={`provider-model-editor-${modelListKey}`} onKeyDown={modelEditorKeyDown}>
        <div className="row model-editor-heading"><h3 id={`provider-model-editor-${modelListKey}`}>{providerName} · {t('ui.edit.models')}</h3><button type="button" autoFocus aria-label={t('ui.close')} disabled={modelBusy || modelListBusy} onClick={closeModelEditor}>×</button></div>
        <div className="provider-model-list"><div className="provider-model-items" role="region" aria-label={`${providerName} ${t('ui.model.options')}`} tabIndex={0}>{models.map(modelRow)}</div>
          {newModelId !== null ? <div className="provider-model-row provider-model-add-row"><input autoFocus aria-label={t('ui.new.model.id')} value={newModelId} onChange={event => setNewModelId(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !modelListBusy && !modelListLoading) void saveAddition(); if (event.key === 'Escape') setNewModelId(null) }} placeholder={t('ui.model.id')} />
            <button type="button" disabled={modelListBusy || modelListLoading} onClick={() => void saveAddition()}>{t('ui.save')}</button><button type="button" onClick={() => setNewModelId(null)}>{t('ui.cancel')}</button></div>
            : <button type="button" className="provider-add-model" onClick={() => setNewModelId('')}>{t('ui.add.model')}</button>}
        </div>
      </div>
    </div>}
  </div>
}
