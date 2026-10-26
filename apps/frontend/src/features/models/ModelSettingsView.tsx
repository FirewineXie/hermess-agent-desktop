import { localizeAppMessage } from '../../i18n'
import { normalizedEndpoint, VOLCENGINE_PRESETS } from './model'
import ProviderCard from './components/ProviderCard'
import type { useModelController } from './useModelController'

type Props = {
  connected: boolean
  language: 'zh-CN' | 'en-US'
  t: (key: string, ...values: unknown[]) => string
  controller: ReturnType<typeof useModelController>
  onOpenRuntime: () => void
}

export default function ModelSettingsView({ connected, language, t, controller, onOpenRuntime }: Props) {
  const backend = connected
  const openView = (_view: 'runtime') => onOpenRuntime()
  const {
    modelProviders, customEndpoints, addingProvider, setAddingProvider, newProviderPreset,
    providerFormError, setProviderFormError, newProviderName, setNewProviderName,
    newProviderUrl, setNewProviderUrl, newProviderModel, setNewProviderModel,
    modelSuggestionsOpen, setModelSuggestionsOpen, modelSuggestionQuery, setModelSuggestionQuery,
    newProviderKey, setNewProviderKey, modelFormOpen, setModelFormOpen, modelProvider,
    modelName, setModelName, modelBaseUrl, setModelBaseUrl, modelKey, setModelKey,
    modelBusy, modelStatus, modelConfirmation, setModelConfirmation,
    modelOptionsLoaded, modelOptionsError, savedModel, addedModels, modelLists,
    modelListBusy, modelListLoading, selectedPreset, backendCandidates, fallbackCandidates,
    modelCandidates, newProviderPresetModels, visibleProviderModels, providerCards,
    loadModelOptions, selectModelProvider, saveProviderModels, addProvider,
    chooseProviderPreset, deleteProvider, saveModel, checkModel,
  } = controller
  return <section className="settings-panel model-settings-panel">
      {!backend ? <div className="empty-panel"><h2>{t("ui.start.the.runtime.first")}</h2><p>{t("ui.model.settings.require.a.connection.to.the.local.hermes.runtime")}</p><button onClick={() => openView('runtime')}>{t("ui.go.to.runtime.storage")}</button></div> : <>
      <div className="row model-page-heading"><h2>{t('ui.model.providers')}</h2><div className="model-page-actions"><button disabled={modelBusy} onClick={() => void loadModelOptions(true)}>{t("ui.reload.settings.and.options")}</button><button type="button" onClick={() => { setProviderFormError(''); setAddingProvider(true) }}>{t('ui.add.provider')}</button></div></div>
      {addingProvider && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !modelBusy) setAddingProvider(false) }}><div className="provider-add-form" role="dialog" aria-modal="true" aria-labelledby="provider-add-title">
        <h3 id="provider-add-title">{t('ui.add.custom.provider')}</h3>
        <label>{t('ui.provider.preset')}<select autoFocus value={newProviderPreset} onChange={event => chooseProviderPreset(event.target.value)}>
          <option value="">{t('ui.custom.provider.template')}</option>
          {VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{t(preset.name)}</option>)}
          {modelProviders.filter(provider => provider.slug !== 'custom' && !provider.slug.startsWith('custom:') && !provider.is_user_defined && !VOLCENGINE_PRESETS.some(preset => preset.id === provider.slug)).map(provider => <option key={provider.slug} value={provider.slug}>{provider.name}</option>)}
        </select></label>
        <small>{t('ui.provider.preset.hint')}</small>
        <label>{t('ui.provider.name')}<input value={newProviderName} onChange={event => setNewProviderName(event.target.value)} /></label>
        <label>{t('ui.provider.endpoint')}<input type="url" value={newProviderUrl} onChange={event => setNewProviderUrl(event.target.value)} placeholder="https://example.com/v1" /></label>
        <label>{t('ui.provider.default.model')}<div className="provider-model-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setModelSuggestionsOpen(false) }}>
          <input role="combobox" aria-autocomplete="list" aria-expanded={modelSuggestionsOpen && visibleProviderModels.length > 0} aria-controls="provider-preset-models" value={newProviderModel} onFocus={() => { setModelSuggestionQuery(''); setModelSuggestionsOpen(true) }} onChange={event => { setNewProviderModel(event.target.value); setModelSuggestionQuery(event.target.value); setModelSuggestionsOpen(true) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setModelSuggestionsOpen(false) } }} />
          {newProviderPresetModels.length > 0 && <button type="button" className="provider-model-toggle" aria-label={t('ui.model.options')} aria-expanded={modelSuggestionsOpen} onClick={() => { setModelSuggestionQuery(''); setModelSuggestionsOpen(value => !value) }}>▾</button>}
          {modelSuggestionsOpen && visibleProviderModels.length > 0 && <div id="provider-preset-models" className="provider-model-suggestions" role="listbox" aria-label={t('ui.model.options')}>
            {visibleProviderModels.map(model => <button type="button" role="option" aria-selected={newProviderModel === model} key={model} onClick={() => { setNewProviderModel(model); setModelSuggestionQuery(''); setModelSuggestionsOpen(false) }}>{model}</button>)}
          </div>}
        </div></label>
        <label>{t('ui.provider.api.key.optional')}<input type="password" autoComplete="off" value={newProviderKey} onChange={event => setNewProviderKey(event.target.value)} /></label>
        {providerFormError && <p role="alert">{providerFormError}</p>}
        <div className="actions"><button disabled={modelBusy || !newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()} onClick={() => void addProvider()}>{t('ui.save.provider')}</button><button type="button" disabled={modelBusy} onClick={() => setAddingProvider(false)}>{t('ui.cancel')}</button></div>
      </div></div>}
      {!modelOptionsLoaded && (modelOptionsError
        ? <p role="alert">{t("ui.failed.to.load.saved.settings")}{modelOptionsError}</p>
        : <p role="status">{t("ui.loading.runtime.model.settings")}</p>)}
      {modelOptionsLoaded && <div className="provider-section">
        <p>{t('ui.provider.model.list.local.note')}</p>
        {providerCards.length === 0 && <p>{t('ui.no.configured.providers')}</p>}
        <div className="provider-grid">{providerCards.map(provider => {
          const endpoint = customEndpoints.find(item => item.id === provider.slug)
            || ((provider.is_user_defined || provider.slug === 'custom' || provider.slug.startsWith('custom:'))
              ? customEndpoints.find(item => Boolean(provider.api_url) && item.base_url.replace(/\/$/, '') === provider.api_url.replace(/\/$/, ''))
              : undefined)
          const modelListKey = endpoint?.id || provider.slug
          const legacyModelListKey = endpoint ? `custom:${endpoint.name.toLowerCase().replace(/\s+/g, '-')}` : provider.slug
          const models = modelLists[modelListKey] ?? modelLists[provider.slug] ?? modelLists[legacyModelListKey]
            ?? [...new Set([...provider.models, ...(addedModels[provider.slug] || [])])]
          return <ProviderCard key={provider.slug} provider={provider} endpoint={endpoint} models={models} modelListKey={modelListKey}
            savedModel={savedModel} modelBusy={modelBusy} modelListBusy={modelListBusy} modelListLoading={modelListLoading} t={t}
            onDeleteProvider={endpoint => void deleteProvider(endpoint)} onSelectModel={selectModelProvider} onSaveModels={saveProviderModels} />
        })}</div>
      </div>}
      {modelFormOpen && <><div className="row model-editor-heading"><h2>{t("ui.select.or.modify.a.model")}</h2><button type="button" onClick={() => { setModelFormOpen(false); setModelConfirmation('') }}>{t('ui.cancel')}</button></div>
      <label>{t("ui.provider")}<select value={modelProvider} onChange={event => {
        selectModelProvider(event.target.value)
      }}>
        {!selectedPreset && !modelProviders.some(provider => provider.slug === modelProvider) && modelProvider !== 'custom' && <option value={modelProvider}>{modelProvider || t("ui.select")}</option>}
        {!modelProviders.some(provider => provider.slug === 'custom') && <option value="custom">{t("ui.custom.openai.compatible.endpoint.custom")}</option>}
        {VOLCENGINE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{t(preset.name)}</option>)}
        {modelProviders.map(provider => <option key={provider.slug} value={provider.slug}>{provider.name}（{provider.slug}）</option>)}
      </select></label>
      {modelLists[modelProvider] === undefined && fallbackCandidates.length > 0 && backendCandidates.length === 0 && <small>{t("ui.displays.built.in.reference.candidates.the.actual.available.models.are.subj")}</small>}
      {modelCandidates.length > 0 && <label>{t("ui.model.options")}<select value={modelCandidates.some(model => model === modelName) ? modelName : ''} onChange={event => { setModelName(event.target.value); setModelConfirmation('') }}>
        <option value="">{t("ui.select.model")}</option>
        {modelCandidates.map(model => <option key={model} value={model}>{model}</option>)}
      </select></label>}
      {modelCandidates.length === 0 && <small>{t("ui.this.provider.currently.has.no.model.candidates.please.fill.in.the.model.id")}</small>}
      <label>{t("ui.model.id.or.enter.one.manually")}<input value={modelName} onChange={event => { setModelName(event.target.value); setModelConfirmation('') }} /></label>
      <label>{t("ui.api.endpoint.for.a.custom.endpoint")}<input value={modelBaseUrl} onChange={event => { setModelBaseUrl(event.target.value); setModelConfirmation('') }} placeholder="https://example.com/v1" /></label>
      <label>{t("ui.api.key.if.you.already.have.a.key.you.can.leave.it.blank")}<input type="password" autoComplete="off" value={modelKey} onChange={event => { setModelKey(event.target.value); setModelConfirmation('') }} /></label>
      <div className="actions"><button disabled={modelBusy || !modelProvider.trim() || !modelName.trim()} onClick={() => void saveModel()}>{t("ui.save.default.model")}</button><button disabled={modelBusy} onClick={() => void checkModel()}>{t("ui.check.runtime")}</button></div>
      {modelConfirmation && <div role="alert"><p>{modelConfirmation}</p><button disabled={modelBusy} onClick={() => void saveModel(true)}>{t("ui.confirm.this.model")}</button></div>}
      </>}
      {modelStatus && <p role="status">{localizeAppMessage(language, modelStatus)}</p>}
      </>}
  </section>
}
