import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { localizeAppMessage } from '../../i18n'
import { getField } from '../agent-settings/model'
import { endpointForProvider, VOLCENGINE_PRESETS } from './model'
import ProviderCard from './components/ProviderCard'
import type { useModelController } from './useModelController'

type Props = {
  connected: boolean
  profile: string | null
  language: 'zh-CN' | 'en-US'
  t: (key: string, ...values: unknown[]) => string
  controller: ReturnType<typeof useModelController>
  onOpenRuntime: () => void
  onOpenMain: () => void
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}

export default function ModelSettingsView({ connected, profile, language, t, controller, onOpenRuntime, onOpenMain, onDirtyChange, onBusyChange }: Props) {
  const {
    modelProviders, customEndpoints, addingProvider, setAddingProvider, editingEndpoint, setEditingEndpoint,
    newProviderPreset, setNewProviderPreset, providerFormError, setProviderFormError,
    newProviderName, setNewProviderName, newProviderUrl, setNewProviderUrl,
    newProviderModel, setNewProviderModel, newProviderKey, setNewProviderKey,
    clearProviderKey, setClearProviderKey, newProviderDiscoverModels, setNewProviderDiscoverModels,
    modelBusy, modelStatus, modelOptionsLoaded, modelOptionsError, savedModel,
    modelListBusy, modelListLoading, discoveryBusy, providerCards, visibleModels,
    loadModelOptions, saveProviderModels, setProviderDiscovery, syncProviderModels,
    addProvider, updateProvider, openProviderEditor, chooseProviderPreset, deleteProvider,
  } = controller
  const { agentSettings } = useDesktop()
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null)
  const [deleteReferences, setDeleteReferences] = React.useState('')
  const [checkingReferences, setCheckingReferences] = React.useState(false)
  const editorOrigin = React.useRef<HTMLElement | null>(null)
  const [cardDrafts, setCardDrafts] = React.useState<Record<string, boolean>>({})
  const changeCardDraft = React.useCallback((key: string, value: boolean) => setCardDrafts(current => current[key] === value ? current : { ...current, [key]: value }), [])
  const deleteRequest = React.useRef(0)
  React.useEffect(() => { ++deleteRequest.current; setDeleteTarget(null); setCardDrafts({}) }, [profile])
  React.useEffect(() => { if (!addingProvider && !deleteTarget && editorOrigin.current) requestAnimationFrame(() => { editorOrigin.current?.isConnected && editorOrigin.current.focus(); editorOrigin.current = null }) }, [addingProvider, deleteTarget])
  const editorDirty = addingProvider && (editingEndpoint
    ? newProviderName !== editingEndpoint.name || newProviderUrl !== editingEndpoint.base_url || newProviderModel !== editingEndpoint.model || Boolean(newProviderKey) || clearProviderKey || newProviderDiscoverModels !== (editingEndpoint.discover_models !== false)
    : Boolean(newProviderName || newProviderUrl || newProviderModel || newProviderKey))
  const dirty = editorDirty || Object.values(cardDrafts).some(Boolean)
  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(modelBusy || modelListBusy || Boolean(discoveryBusy)); return () => onBusyChange(false) }, [modelBusy, modelListBusy, discoveryBusy, onBusyChange])
  const closeEditor = () => { setAddingProvider(false); setEditingEndpoint(null); setProviderFormError('') }
  const openEditor = () => {
    editorOrigin.current = document.activeElement as HTMLElement
    setEditingEndpoint(null); setProviderFormError(''); setNewProviderPreset(''); setNewProviderName('')
    setNewProviderUrl(''); setNewProviderModel(''); setNewProviderKey(''); setClearProviderKey(false)
    setNewProviderDiscoverModels(true); setAddingProvider(true)
  }
  const askDelete = async (id: string) => {
    if (!profile) return
    editorOrigin.current = document.activeElement as HTMLElement
    const current = ++deleteRequest.current
    setDeleteTarget(id); setDeleteReferences(''); setCheckingReferences(true)
    try {
      const config = await agentSettings.config({ kind: 'profile', profile })
      const references: string[] = []
      if (savedModel?.provider === id || customEndpoints.find(item => item.id === id)?.is_current) references.push(language === 'zh-CN' ? '主模型' : 'Main model')
      const fallback = getField(config, 'fallback_providers')
      if (Array.isArray(fallback) && fallback.some(item => item && typeof item === 'object' ? String(item.provider) === id : typeof item === 'string' && item.startsWith(`${id}/`))) references.push(language === 'zh-CN' ? '回退模型' : 'Fallback models')
      const auxiliary = getField(config, 'auxiliary')
      if (auxiliary && typeof auxiliary === 'object' && Object.values(auxiliary).some(item => item && typeof item === 'object' && String((item as Record<string, unknown>).provider) === id)) references.push(language === 'zh-CN' ? '辅助模型' : 'Auxiliary models')
      if (current === deleteRequest.current) setDeleteReferences(references.length ? `${language === 'zh-CN' ? '仍被引用：' : 'Still referenced: '}${references.join('、')}` : '')
    } catch (cause) { if (current === deleteRequest.current) setDeleteReferences(describeError(cause, language)) }
    finally { if (current === deleteRequest.current) setCheckingReferences(false) }
  }
  const dialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, close: () => void) => {
    if (event.key === 'Escape' && !modelBusy) { event.stopPropagation(); close(); return }
    if (event.key !== 'Tab') return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
    if (!items.length) return
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus() }
    else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
  }
  React.useEffect(() => {
    if (!addingProvider) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !modelBusy) closeEditor() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [addingProvider, modelBusy])
  return <section className="settings-panel model-settings-panel">
    {!connected || !profile ? <div className="empty-panel"><h2>{t('ui.start.the.runtime.first')}</h2><p>{t('ui.model.settings.require.a.connection.to.the.local.hermes.runtime')}</p><button onClick={onOpenRuntime}>{t('ui.go.to.runtime.storage')}</button></div> : <>
      <div className="row model-page-heading"><h2>{t('ui.model.providers')}</h2><div className="model-page-actions"><button disabled={modelBusy} onClick={() => void loadModelOptions()}>{t('ui.reload.settings.and.options')}</button><button type="button" onClick={openEditor}>{t('ui.add.provider')}</button></div></div>
      <p>{t('ui.provider.model.list.local.note')}</p>
      {!modelOptionsLoaded && <p role={modelOptionsError ? 'alert' : 'status'}>{modelOptionsError || t('ui.loading.runtime.model.settings')}</p>}
      {modelOptionsLoaded && <div className="provider-section">{providerCards.length === 0 && <p>{t('ui.no.configured.providers')}</p>}
        <div className="provider-grid">{providerCards.map(provider => {
          const endpoint = endpointForProvider(provider, customEndpoints)
          const modelListKey = endpoint?.id || provider.slug
          return <ProviderCard key={`${profile}:${provider.slug}`} provider={provider} endpoint={endpoint} models={visibleModels(provider.slug)} modelListKey={modelListKey}
            savedModel={savedModel} modelBusy={modelBusy} modelListBusy={modelListBusy} modelListLoading={modelListLoading} discoveryBusy={Boolean(discoveryBusy)} t={t}
            onDeleteProvider={item => { void askDelete(item.id) }}
            onEditProvider={(_, item) => { if (item && item.source !== 'direct-config') { editorOrigin.current = document.activeElement as HTMLElement; openProviderEditor(item) } else onOpenMain() }}
            onSaveModels={saveProviderModels} onSetDiscovery={(item, enabled) => void setProviderDiscovery(item, enabled)}
            onSyncModels={() => void syncProviderModels(provider.slug, modelListKey)}
            onDirtyChange={changeCardDraft} />
        })}</div></div>}
      {deleteTarget && <div className="provider-modal-backdrop"><div className="provider-add-form" role="dialog" aria-modal="true" aria-label={language === 'zh-CN' ? '删除提供商' : 'Delete provider'} onKeyDown={event => dialogKeyDown(event, () => setDeleteTarget(null))}>
        <h3>{language === 'zh-CN' ? '删除提供商' : 'Delete provider'}</h3><p>{customEndpoints.find(item => item.id === deleteTarget)?.name}</p>
        {deleteReferences && <p role="alert">{deleteReferences}</p>}
        <p>{language === 'zh-CN' ? '删除前请确认主模型、回退链和辅助任务是否引用此提供商。' : 'Check main, fallback, and auxiliary references before deletion.'}</p>
        <div className="actions"><button type="button" disabled={modelBusy || checkingReferences || Boolean(deleteReferences)} onClick={() => { const target = customEndpoints.find(item => item.id === deleteTarget); setDeleteTarget(null); if (target) void deleteProvider(target) }}>{t('ui.delete.provider')}</button><button type="button" autoFocus onClick={() => setDeleteTarget(null)}>{t('ui.cancel')}</button></div>
      </div></div>}
      {addingProvider && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !modelBusy) closeEditor() }}><div className="provider-add-form" role="dialog" aria-modal="true" aria-labelledby="provider-add-title" onKeyDown={event => dialogKeyDown(event, closeEditor)}>
        <div className="row model-editor-heading"><h3 id="provider-add-title">{t(editingEndpoint ? 'ui.edit.provider' : 'ui.add.custom.provider')}</h3><button type="button" aria-label={t('ui.close')} disabled={modelBusy} onClick={closeEditor}>×</button></div>
        {!editingEndpoint && <label>{t('ui.provider.preset')}<select autoFocus value={newProviderPreset} onChange={event => chooseProviderPreset(event.target.value)}><option value="">{t('ui.custom.provider.template')}</option>{VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{t(preset.name)}</option>)}{modelProviders.filter(item => item.slug !== 'custom' && !item.slug.startsWith('custom:') && !item.is_user_defined).map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>}
        <label>{t('ui.provider.name')}<input autoFocus={Boolean(editingEndpoint)} value={newProviderName} onChange={event => setNewProviderName(event.target.value)} /></label>
        <label>{t('ui.provider.endpoint')}<input type="url" value={newProviderUrl} onChange={event => setNewProviderUrl(event.target.value)} placeholder="https://api.your-provider.example/v1" /></label>
        <label>{language === 'zh-CN' ? '初始模型 ID' : 'Initial model ID'}<input value={newProviderModel} onChange={event => setNewProviderModel(event.target.value)} placeholder={t('ui.model.id')} /></label>
        <label>{t('ui.provider.api.key.optional')}<input type="password" autoComplete="off" value={newProviderKey} disabled={clearProviderKey} onChange={event => setNewProviderKey(event.target.value)} /></label>
        {editingEndpoint && <><small>{t('ui.provider.key.keep.hint')}</small><label className="provider-make-default"><input type="checkbox" checked={clearProviderKey} onChange={event => { setClearProviderKey(event.target.checked); setNewProviderKey('') }} />{t('ui.provider.clear.key')}</label></>}
        <label className="provider-make-default"><input type="checkbox" checked={newProviderDiscoverModels} onChange={event => setNewProviderDiscoverModels(event.target.checked)} />{t('ui.provider.discover.models')}</label>
        {providerFormError && <p role="alert">{providerFormError}</p>}
        <div className="actions"><button disabled={modelBusy || !newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()} onClick={() => void (editingEndpoint ? updateProvider() : addProvider())}>{t('ui.save.provider')}</button><button type="button" disabled={modelBusy} onClick={closeEditor}>{t('ui.cancel')}</button></div>
      </div></div>}
      {modelStatus && <p role="status">{localizeAppMessage(language, modelStatus)}</p>}
    </>}
  </section>
}
