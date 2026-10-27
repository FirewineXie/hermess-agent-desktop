import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { localizeAppMessage } from '../../i18n'
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
}

export default function ModelSettingsView({ connected, profile, language, t, controller, onOpenRuntime }: Props) {
  const backend = connected
  const openView = (_view: 'runtime') => onOpenRuntime()
  const {
    modelProviders, customEndpoints, addingProvider, setAddingProvider, editingEndpoint, setEditingEndpoint, newProviderPreset, setNewProviderPreset,
    providerFormError, setProviderFormError, newProviderName, setNewProviderName,
    newProviderUrl, setNewProviderUrl, newProviderModel, setNewProviderModel,
    newProviderKey, setNewProviderKey, clearProviderKey, setClearProviderKey, newProviderMakeDefault, setNewProviderMakeDefault, newProviderDiscoverModels, setNewProviderDiscoverModels, modelFormOpen, setModelFormOpen, modelProvider,
    modelName, setModelName, modelBaseUrl, setModelBaseUrl, modelKey, setModelKey,
    modelBusy, modelStatus, modelConfirmation, setModelConfirmation,
    modelOptionsLoaded, modelOptionsError, savedModel,
    modelListBusy, modelListLoading, discoveryBusy, selectedPreset, modelCandidates, providerCards, visibleModels,
    loadModelOptions, selectModelProvider, saveProviderModels, saveProviderDefault, setProviderDiscovery, syncProviderModels, addProvider, updateProvider, openProviderEditor,
    chooseProviderPreset, deleteProvider, saveModel, checkModel,
  } = controller
  const [editingProviderName, setEditingProviderName] = useState('')
  const [builtinEditor, setBuiltinEditor] = useState<{ slug: string; name: string; modelListKey: string } | null>(null)
  const [builtinUrlDraft, setBuiltinUrlDraft] = useState('')
  const [builtinDefaultDraft, setBuiltinDefaultDraft] = useState('')
  const [builtinAutoDiscover, setBuiltinAutoDiscover] = useState(false)
  const [builtinConfirm, setBuiltinConfirm] = useState(false)
  const [builtinSubmitted, setBuiltinSubmitted] = useState(false)
  const builtinAutoSyncAttempted = useRef(false)
  const modelEditorOrigin = useRef<HTMLElement | null>(null)
  const restoreEditorFocus = () => requestAnimationFrame(() => { if (modelEditorOrigin.current?.isConnected) modelEditorOrigin.current.focus() })
  const closeModelEditor = () => {
    setModelFormOpen(false)
    setModelConfirmation('')
    setEditingProviderName('')
    restoreEditorFocus()
  }
  const closeBuiltinEditor = () => { setBuiltinEditor(null); setBuiltinConfirm(false); setBuiltinSubmitted(false); restoreEditorFocus() }
  const autoDiscoverKey = (slug: string) => `hermess.desktop.auto-model-sync.v1:${profile || ''}:${slug}`
  const openBuiltinEditor = (provider: { slug: string; name: string; api_url?: string; is_current?: boolean }, modelListKey: string, models: string[]) => {
    const url = provider.api_url || (provider.is_current ? savedModel?.baseUrl : '') || ''
    setBuiltinEditor({ slug: provider.slug, name: provider.name, modelListKey })
    setBuiltinUrlDraft(url)
    setBuiltinDefaultDraft(savedModel?.provider === provider.slug ? savedModel.model : models[0] || '')
    setBuiltinConfirm(false)
    setBuiltinSubmitted(false)
    builtinAutoSyncAttempted.current = false
    let enabled = false
    try { enabled = localStorage.getItem(autoDiscoverKey(provider.slug)) === 'true' } catch { /* optional local preference */ }
    setBuiltinAutoDiscover(enabled)
  }
  const syncBuiltinModels = async () => {
    if (!builtinEditor) return
    await syncProviderModels(builtinEditor.slug, builtinEditor.modelListKey)
    setBuiltinSubmitted(true)
  }
  useEffect(() => {
    if (!builtinEditor || !builtinAutoDiscover || modelListLoading || modelListBusy || builtinAutoSyncAttempted.current) return
    builtinAutoSyncAttempted.current = true
    void syncBuiltinModels()
  }, [builtinEditor, builtinAutoDiscover, modelListLoading, modelListBusy])
  const changeBuiltinAutoDiscover = (enabled: boolean) => {
    if (!builtinEditor) return
    setBuiltinAutoDiscover(enabled)
    try { localStorage.setItem(autoDiscoverKey(builtinEditor.slug), String(enabled)) } catch { /* sync remains available in this window */ }
    builtinAutoSyncAttempted.current = false
  }
  const saveBuiltinDefault = async (confirm = false) => {
    if (!builtinEditor || !builtinDefaultDraft) return
    const result = await saveProviderDefault(builtinEditor.slug, builtinDefaultDraft, builtinUrlDraft, confirm)
    setBuiltinConfirm(result === 'confirm')
    setBuiltinSubmitted(true)
  }
  const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
    if (!items.length) return
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus() }
    else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
  }
  return <section className="settings-panel model-settings-panel">
      {!backend ? <div className="empty-panel"><h2>{t("ui.start.the.runtime.first")}</h2><p>{t("ui.model.settings.require.a.connection.to.the.local.hermes.runtime")}</p><button onClick={() => openView('runtime')}>{t("ui.go.to.runtime.storage")}</button></div> : <>
      <div className="row model-page-heading"><h2>{t('ui.model.providers')}</h2><div className="model-page-actions"><button disabled={modelBusy} onClick={() => void loadModelOptions()}>{t("ui.reload.settings.and.options")}</button><button type="button" onClick={() => { setEditingEndpoint(null); setProviderFormError(''); setNewProviderPreset(''); setNewProviderName(''); setNewProviderUrl(''); setNewProviderModel(''); setNewProviderKey(''); setClearProviderKey(false); setNewProviderMakeDefault(true); setNewProviderDiscoverModels(true); setAddingProvider(true) }}>{t('ui.add.provider')}</button></div></div>
      {addingProvider && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !modelBusy) { setAddingProvider(false); setEditingEndpoint(null) } }}><div className="provider-add-form" role="dialog" aria-modal="true" aria-labelledby="provider-add-title" onKeyDown={trapDialogFocus}>
        <div className="row model-editor-heading"><h3 id="provider-add-title">{t(editingEndpoint ? 'ui.edit.provider' : 'ui.add.custom.provider')}</h3><button type="button" aria-label={t('ui.close')} disabled={modelBusy} onClick={() => { setAddingProvider(false); setEditingEndpoint(null) }}>×</button></div>
        {!editingEndpoint && <label>{t('ui.provider.preset')}<select autoFocus value={newProviderPreset} onChange={event => chooseProviderPreset(event.target.value)}>
          <option value="">{t('ui.custom.provider.template')}</option>
          {VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{t(preset.name)}</option>)}
          {modelProviders.filter(provider => provider.slug !== 'custom' && !provider.slug.startsWith('custom:') && !provider.is_user_defined && !VOLCENGINE_PRESETS.some(preset => preset.id === provider.slug)).map(provider => <option key={provider.slug} value={provider.slug}>{provider.name}</option>)}
        </select></label>}
        {!editingEndpoint && <small>{t('ui.provider.preset.hint')}</small>}
        <label>{t('ui.provider.name')}<input autoFocus={Boolean(editingEndpoint)} value={newProviderName} onChange={event => setNewProviderName(event.target.value)} /></label>
        <label>{t('ui.provider.endpoint')}<input type="url" value={newProviderUrl} onChange={event => setNewProviderUrl(event.target.value)} placeholder="https://example.com/v1" /></label>
        <label>{t('ui.provider.default.model')}<input value={newProviderModel} onChange={event => setNewProviderModel(event.target.value)} placeholder={t('ui.model.id')} /></label>
        <label>{t('ui.provider.api.key.optional')}<input type="password" autoComplete="off" value={newProviderKey} disabled={clearProviderKey} onChange={event => setNewProviderKey(event.target.value)} /></label>
        {editingEndpoint && <><small>{t('ui.provider.key.keep.hint')}</small><label className="provider-make-default"><input type="checkbox" checked={clearProviderKey} onChange={event => { setClearProviderKey(event.target.checked); setNewProviderKey('') }} />{t('ui.provider.clear.key')}</label></>}
        <label className="provider-make-default"><input type="checkbox" checked={newProviderMakeDefault} disabled={Boolean(editingEndpoint?.is_current)} onChange={event => setNewProviderMakeDefault(event.target.checked)} />{t(editingEndpoint ? 'ui.provider.save.as.default' : 'ui.provider.make.default')}</label>
        <label className="provider-make-default"><input type="checkbox" checked={newProviderDiscoverModels} onChange={event => setNewProviderDiscoverModels(event.target.checked)} />{t('ui.provider.discover.models')}</label>
        {providerFormError && <p role="alert">{providerFormError}</p>}
        <div className="actions"><button disabled={modelBusy || !newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()} onClick={() => void (editingEndpoint ? updateProvider() : addProvider())}>{t('ui.save.provider')}</button><button type="button" disabled={modelBusy} onClick={() => { setAddingProvider(false); setEditingEndpoint(null) }}>{t('ui.cancel')}</button></div>
      </div></div>}
      {!modelOptionsLoaded && (modelOptionsError
        ? <p role="alert">{t("ui.failed.to.load.saved.settings")}{modelOptionsError}</p>
        : <p role="status">{t("ui.loading.runtime.model.settings")}</p>)}
      {modelOptionsLoaded && <div className="provider-section">
        <p>{t('ui.provider.model.list.local.note')}</p>
        {providerCards.length === 0 && <p>{t('ui.no.configured.providers')}</p>}
        <div className="provider-grid">{providerCards.map(provider => {
          const endpoint = endpointForProvider(provider, customEndpoints)
          const modelListKey = endpoint?.id || provider.slug
          const models = visibleModels(provider.slug)
          return <ProviderCard key={provider.slug} provider={provider} endpoint={endpoint} models={models} modelListKey={modelListKey}
            savedModel={savedModel} modelBusy={modelBusy} modelListBusy={modelListBusy} modelListLoading={modelListLoading} discoveryBusy={Boolean(discoveryBusy)} t={t}
            onDeleteProvider={endpoint => void deleteProvider(endpoint)} onEditProvider={(provider, endpoint) => {
              if (endpoint && endpoint.source !== 'direct-config') { openProviderEditor(endpoint); return }
              modelEditorOrigin.current = document.activeElement as HTMLElement
              if (!endpoint && !provider.is_user_defined) {
                openBuiltinEditor(provider, modelListKey, models)
                return
              }
              setEditingProviderName(endpoint?.name || provider.name)
              selectModelProvider(provider.slug, endpoint?.model || models[0] || (provider.is_current ? savedModel?.model : '') || '')
              setModelBaseUrl(endpoint?.base_url || provider.api_url || (provider.is_current ? savedModel?.baseUrl : '') || '')
            }} onSelectModel={(provider, model) => { modelEditorOrigin.current = document.activeElement as HTMLElement; setEditingProviderName(''); selectModelProvider(provider, model) }} onSaveModels={saveProviderModels}
            onSetDiscovery={(endpoint, enabled) => void setProviderDiscovery(endpoint, enabled)}
            onSyncModels={() => void syncProviderModels(provider.slug, modelListKey)} />
        })}</div>
      </div>}
      {builtinEditor && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !modelListBusy && !modelBusy) closeBuiltinEditor() }}><div className="provider-add-form" role="dialog" aria-modal="true" aria-labelledby="builtin-editor-title" onKeyDown={event => { trapDialogFocus(event); if (event.key === 'Escape' && !modelListBusy && !modelBusy) { event.stopPropagation(); closeBuiltinEditor() } }}>
        <div className="row model-editor-heading"><h2 id="builtin-editor-title">{t('ui.edit.provider')} · {builtinEditor.name}</h2><button type="button" aria-label={t('ui.close')} disabled={modelListBusy || modelBusy} onClick={closeBuiltinEditor}>×</button></div>
        <label>{t('ui.provider.endpoint')}<input autoFocus type="url" value={builtinUrlDraft} onChange={event => setBuiltinUrlDraft(event.target.value)} placeholder={t('ui.builtin.provider.url.placeholder')} /></label>
        <p className="builtin-provider-note">{t('ui.builtin.provider.url.hint')}</p>
        <div className="builtin-provider-models"><strong>{t('ui.model.options')}</strong>{visibleModels(builtinEditor.slug).length
          ? <ul>{visibleModels(builtinEditor.slug).map(model => <li key={model}>{model}</li>)}</ul>
          : <p>{t('ui.builtin.provider.no.models')}</p>}</div>
        <label className="provider-make-default"><input type="checkbox" checked={builtinAutoDiscover} disabled={modelListBusy || modelListLoading || Boolean(discoveryBusy)} onChange={event => changeBuiltinAutoDiscover(event.target.checked)} />{t('ui.builtin.provider.auto.sync')}</label>
        <label>{t('ui.builtin.provider.default.model')}<select value={builtinDefaultDraft} onChange={event => { setBuiltinDefaultDraft(event.target.value); setBuiltinConfirm(false) }}>
          <option value="">{t('ui.select.model')}</option>
          {visibleModels(builtinEditor.slug).map(model => <option key={model} value={model}>{model}</option>)}
        </select></label>
        <p className="builtin-provider-note">{t('ui.builtin.provider.local.models')}</p>
        {builtinSubmitted && modelStatus && <p role="status">{localizeAppMessage(language, modelStatus)}</p>}
        {builtinConfirm && <button type="button" disabled={modelBusy} onClick={() => void saveBuiltinDefault(true)}>{t('ui.confirm.this.model')}</button>}
        <div className="actions"><button type="button" disabled={modelListBusy || modelListLoading || Boolean(discoveryBusy)} onClick={() => void syncBuiltinModels()}>{t('ui.provider.sync.models')}</button><button type="button" disabled={modelBusy || modelListBusy || !builtinDefaultDraft} onClick={() => void saveBuiltinDefault()}>{t('ui.save.default.model')}</button><button type="button" disabled={modelListBusy || modelBusy} onClick={closeBuiltinEditor}>{t('ui.close')}</button></div>
      </div></div>}
      {modelFormOpen && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !modelBusy) closeModelEditor() }}><div className="provider-add-form" role="dialog" aria-modal="true" aria-labelledby="model-editor-title" onKeyDown={event => { trapDialogFocus(event); if (event.key === 'Escape' && !modelBusy) { event.stopPropagation(); closeModelEditor() } }}>
      <div className="row model-editor-heading"><h2 id="model-editor-title">{editingProviderName ? `${t('ui.edit.provider')} · ${editingProviderName}` : t("ui.select.or.modify.a.model")}</h2><button type="button" aria-label={t('ui.close')} disabled={modelBusy} onClick={closeModelEditor}>×</button></div>
      <label>{t("ui.provider")}<select value={modelProvider} onChange={event => {
        selectModelProvider(event.target.value)
      }} disabled={Boolean(editingProviderName)}>
        {!selectedPreset && !modelProviders.some(provider => provider.slug === modelProvider) && modelProvider !== 'custom' && <option value={modelProvider}>{modelProvider || t("ui.select")}</option>}
        {!modelProviders.some(provider => provider.slug === 'custom') && <option value="custom">{t("ui.custom.openai.compatible.endpoint.custom")}</option>}
        {VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{t(preset.name)}</option>)}
        {modelProviders.map(provider => <option key={provider.slug} value={provider.slug}>{provider.name}（{provider.slug}）</option>)}
      </select></label>
      <label>{t('ui.model')}<input autoFocus list="model-editor-candidates" value={modelName} onChange={event => { setModelName(event.target.value); setModelConfirmation('') }} placeholder={t('ui.provider.model.choose.or.enter')} /></label>
      <datalist id="model-editor-candidates">{modelCandidates.map(model => <option key={model} value={model} />)}</datalist>
      <label>{t("ui.api.endpoint.for.a.custom.endpoint")}<input value={modelBaseUrl} onChange={event => { setModelBaseUrl(event.target.value); setModelConfirmation('') }} placeholder="https://example.com/v1" /></label>
      <label>{t("ui.api.key.if.you.already.have.a.key.you.can.leave.it.blank")}<input type="password" autoComplete="off" value={modelKey} onChange={event => { setModelKey(event.target.value); setModelConfirmation('') }} /></label>
      <div className="actions"><button disabled={modelBusy || !modelProvider.trim() || !modelName.trim()} onClick={() => void saveModel().then(saved => { if (saved) closeModelEditor() })}>{t("ui.save.default.model")}</button><button disabled={modelBusy} onClick={() => void checkModel()}>{t("ui.check.runtime")}</button></div>
      {modelConfirmation && <div role="alert"><p>{modelConfirmation}</p><button disabled={modelBusy} onClick={() => void saveModel(true).then(saved => { if (saved) closeModelEditor() })}>{t("ui.confirm.this.model")}</button></div>}
      {modelStatus && <p role="status">{localizeAppMessage(language, modelStatus)}</p>}
      </div></div>}
      {!modelFormOpen && !builtinEditor && modelStatus && <p role="status">{localizeAppMessage(language, modelStatus)}</p>}
      </>}
  </section>
}
