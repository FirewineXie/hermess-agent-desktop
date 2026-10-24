import React from 'react'
import type { BackendInfo } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { desktopModelProviderSupported, normalizedEndpoint, readAddedModels, readModelLists, VOLCENGINE_PRESETS, savedModelFromOptions, MODEL_FALLBACKS, ADDED_MODELS_KEY, MODEL_LISTS_KEY, type ModelProvider, type CustomEndpoint, type ModelPick, type SavedModel } from './model'

type Options = {
  backend: BackendInfo | null
  storagePath: string
  t: (key: string, ...values: unknown[]) => string
  sessionRef: React.RefObject<string>
  turnBusy: boolean
  ensureChatSession: () => Promise<string>
  setChatStatus: React.Dispatch<React.SetStateAction<string>>
  setActiveModel: React.Dispatch<React.SetStateAction<ModelPick | null>>
}

export function useModelController({ backend, storagePath, t, sessionRef, turnBusy, ensureChatSession, setChatStatus, setActiveModel }: Options) {
  const { models } = useDesktop()
  const [modelProviders, setModelProviders] = React.useState<ModelProvider[]>([])
  const [configuredProviders, setConfiguredProviders] = React.useState<ModelProvider[]>([])
  const [customEndpoints, setCustomEndpoints] = React.useState<CustomEndpoint[]>([])
  const [addingProvider, setAddingProvider] = React.useState(false)
  const [newProviderPreset, setNewProviderPreset] = React.useState('')
  const [providerFormError, setProviderFormError] = React.useState('')
  const [newProviderName, setNewProviderName] = React.useState('')
  const [newProviderUrl, setNewProviderUrl] = React.useState('')
  const [newProviderModel, setNewProviderModel] = React.useState('')
  const [modelSuggestionsOpen, setModelSuggestionsOpen] = React.useState(false)
  const [modelSuggestionQuery, setModelSuggestionQuery] = React.useState('')
  const [newProviderKey, setNewProviderKey] = React.useState('')
  const [modelFormOpen, setModelFormOpen] = React.useState(false)
  const [modelProvider, setModelProvider] = React.useState('')
  const [modelName, setModelName] = React.useState('')
  const [modelBaseUrl, setModelBaseUrl] = React.useState('')
  const [modelKey, setModelKey] = React.useState('')
  const [modelBusy, setModelBusy] = React.useState(false)
  const [modelStatus, setModelStatus] = React.useState('')
  const [modelConfirmation, setModelConfirmation] = React.useState('')
  const [modelOptionsLoaded, setModelOptionsLoaded] = React.useState(false)
  const [modelOptionsError, setModelOptionsError] = React.useState('')
  const [savedModel, setSavedModel] = React.useState<SavedModel | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false)
  const modelButtonRef = React.useRef<HTMLButtonElement>(null)
  const modelPickerRef = React.useRef<HTMLDivElement>(null)
  const [pickerPosition, setPickerPosition] = React.useState<React.CSSProperties>({})
  const [pickerProviders, setPickerProviders] = React.useState<ModelProvider[]>([])
  const [pickerProvider, setPickerProvider] = React.useState('')
  const [pickerModelInput, setPickerModelInput] = React.useState('')
  const [pickerBusy, setPickerBusy] = React.useState(false)
  const [pickerError, setPickerError] = React.useState('')
  const [pickerConfirmation, setPickerConfirmation] = React.useState<{ provider: string; model: string; remember: boolean; token: string; message: string } | null>(null)
  const [addedModels, setAddedModels] = React.useState<Record<string, string[]>>({})
  const [modelLists, setModelLists] = React.useState<Record<string, string[]>>({})
  const [modelListBusy, setModelListBusy] = React.useState(false)
  const [modelListLoading, setModelListLoading] = React.useState(true)
  React.useEffect(() => {
    setAddedModels(readAddedModels(storagePath))
    const legacyLists = readModelLists(storagePath)
    setModelLists(legacyLists)
    if (!storagePath) return
    let active = true
    setModelListLoading(true)
    void models.loadLists(storagePath).then(saved => {
      if (!active) return
      if (saved !== null) setModelLists(saved)
      else if (Object.keys(legacyLists).length) return models.saveLists(storagePath, legacyLists)
    }).catch(cause => { if (active) setModelStatus(t('ui.failed.to.save.provider.models.arg', String(cause))) })
      .finally(() => { if (active) setModelListLoading(false) })
    return () => { active = false }
  }, [storagePath])
  const selectedPreset = VOLCENGINE_PRESETS.find(preset => preset.id === modelProvider)
  function savedCandidates(slug: string, providers: ModelProvider[]): string[] | undefined {
    const row = providers.find(provider => provider.slug === slug)
    const endpoint = customEndpoints.find(item => item.id === slug
      || (row?.api_url && normalizedEndpoint(item.base_url) === normalizedEndpoint(row.api_url)))
    return modelLists[endpoint?.id || slug] ?? modelLists[slug]
      ?? (endpoint ? modelLists[`custom:${endpoint.name.toLowerCase().replace(/\s+/g, '-')}`] : undefined)
  }
  const backendCandidates = modelProviders.find(provider => provider.slug === modelProvider)?.models || []
  const fallbackCandidates = selectedPreset?.models || MODEL_FALLBACKS[modelProvider] || []
  const modelCandidates = savedCandidates(modelProvider, modelProviders) ?? [...new Set([...(backendCandidates.length > 0 ? backendCandidates : fallbackCandidates), ...(addedModels[modelProvider] || [])])]
  const pickerModels = savedCandidates(pickerProvider, pickerProviders) ?? [...new Set([...(pickerProviders.find(row => row.slug === pickerProvider)?.models || []), ...(addedModels[pickerProvider] || [])])]
  const newProviderPresetModels = newProviderPreset.startsWith('preset:')
    ? VOLCENGINE_PRESETS.find(preset => `preset:${preset.id}` === newProviderPreset)?.models || []
    : (() => {
      const models = modelProviders.find(provider => provider.slug === newProviderPreset)?.models || []
      return models.length ? models : MODEL_FALLBACKS[newProviderPreset] || []
    })()
  const visibleProviderModels = newProviderPresetModels.filter(model => model.toLowerCase().includes(modelSuggestionQuery.toLowerCase()))
  const savedPreset = savedModel?.provider === 'custom'
    ? VOLCENGINE_PRESETS.find(preset => normalizedEndpoint(preset.baseUrl) === normalizedEndpoint(savedModel.baseUrl))
    : undefined
  const providerCards = configuredProviders
    .filter(provider => desktopModelProviderSupported(provider.slug) && (provider.slug !== 'custom' || !savedPreset))
    .map(provider => ({ slug: provider.slug, name: provider.name, api_url: provider.api_url || '', is_user_defined: Boolean(provider.is_user_defined), models: provider.models.length ? provider.models : [...(MODEL_FALLBACKS[provider.slug] || [])] }))
  if (savedModel && desktopModelProviderSupported(savedModel.provider)
    && !providerCards.some(provider => provider.slug === (savedPreset?.id || savedModel.provider)
      || (savedModel.baseUrl && normalizedEndpoint(provider.api_url) === normalizedEndpoint(savedModel.baseUrl)))
    && !customEndpoints.some(endpoint => endpoint.source !== 'direct-config' && savedModel.baseUrl && normalizedEndpoint(endpoint.base_url) === normalizedEndpoint(savedModel.baseUrl))) {
    providerCards.unshift({ slug: savedPreset?.id || savedModel.provider, name: t(savedModel.name), api_url: savedModel.baseUrl, is_user_defined: savedModel.provider === 'custom', models: savedPreset ? [...savedPreset.models] : [savedModel.model] })
  }
  for (const endpoint of customEndpoints) {
    if (endpoint.source === 'direct-config' || providerCards.some(provider => provider.slug === endpoint.id || (provider.api_url && normalizedEndpoint(provider.api_url) === normalizedEndpoint(endpoint.base_url)))) continue
    providerCards.push({ slug: endpoint.id, name: endpoint.name, api_url: endpoint.base_url, is_user_defined: true, models: endpoint.models.length ? endpoint.models : [endpoint.model] })
  }

  React.useEffect(() => {
    if (!addingProvider) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !modelBusy) setAddingProvider(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [addingProvider, modelBusy])

  const positionModelPicker = React.useCallback(() => {
    const button = modelButtonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const width = Math.min(340, window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
    const above = rect.top - 12
    const below = window.innerHeight - rect.bottom - 12
    setPickerPosition(above >= 260 || above >= below
      ? { left, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(390, Math.max(120, above - 8)) }
      : { left, top: rect.bottom + 8, maxHeight: Math.min(390, Math.max(120, below - 8)) })
  }, [])

  React.useEffect(() => {
    if (!modelPickerOpen) return
    positionModelPicker()
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!modelPickerRef.current?.contains(target) && !modelButtonRef.current?.contains(target)) setModelPickerOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setModelPickerOpen(false) }
    window.addEventListener('resize', positionModelPicker)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', positionModelPicker)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [modelPickerOpen, positionModelPicker])
  async function loadModelOptions(preserveSelection = false) {
    setModelBusy(true)
    setModelOptionsError('')
    setModelStatus(preserveSelection ? t("ui.refreshing.backend.model.directory") : t("ui.loading.model.options"))
    try {
      const [result, configured, config, endpoints] = await Promise.all([
        models.options({ refresh: preserveSelection }),
        models.options({ refresh: false, includeUnconfigured: false }),
        models.savedConfig(),
        models.endpoints(),
      ])
      setCustomEndpoints(endpoints.endpoints || [])
      const availableProviders = (result.providers || []).filter(provider => desktopModelProviderSupported(provider.slug))
      setModelProviders(availableProviders)
      setConfiguredProviders((configured.providers || []).filter(provider => desktopModelProviderSupported(provider.slug) && provider.authenticated !== false))
      const saved = savedModelFromOptions(result, config)
      setSavedModel(saved)
      setModelOptionsLoaded(true)
      if (!preserveSelection) {
        const preset = saved?.provider === 'custom'
          ? VOLCENGINE_PRESETS.find(item => item.baseUrl.replace(/\/$/, '').toLowerCase() === saved.baseUrl.replace(/\/$/, '').toLowerCase())
          : undefined
        const savedProviderSupported = saved && desktopModelProviderSupported(saved.provider)
        setModelProvider(preset?.id || (savedProviderSupported ? saved.provider : '') || availableProviders[0]?.slug || 'custom')
        setModelName(savedProviderSupported ? saved.model : '')
        setModelBaseUrl(saved?.provider === 'custom' ? saved.baseUrl : '')
      }
      if (preserveSelection) {
        const count = result.providers?.find(provider => provider.slug === modelProvider)?.models?.length || 0
        setModelStatus(selectedPreset
          ? t("ui.the.backend.directory.has.been.refreshed.volcano.ark.s.built.in.reference.c")
          : t("ui.backend.catalog.refreshed.current.provider.returned.arg.models.arg", count, count ? '' : t('ui.built.in.examples.or.manual.entry.remain.available')))
      } else {
        setModelStatus('')
      }
    } catch (cause) {
      setModelOptionsError(String(cause))
      setModelStatus(t("ui.failed.to.load.model.options.arg", String(cause)))
    }
    finally { setModelBusy(false) }
  }

  function selectModelProvider(provider: string, model = '', fresh = false) {
    const preset = VOLCENGINE_PRESETS.find(row => row.id === provider)
    setModelProvider(provider)
    setModelName(model)
    setModelBaseUrl(preset?.baseUrl || (!fresh && savedModel?.provider === provider ? savedModel.baseUrl : ''))
    setModelConfirmation('')
    setModelFormOpen(true)
  }

  async function persistModelLists(next: Record<string, string[]>) {
    await models.saveLists(storagePath, next)
    setModelLists(next)
    try { localStorage.setItem(`${MODEL_LISTS_KEY}:${storagePath}`, JSON.stringify(next)) } catch { /* Native storage is authoritative. */ }
  }

  async function saveProviderModels(provider: string, models: string[]): Promise<boolean> {
    if (modelListLoading || modelListBusy) return false
    if (models.some(model => !model.trim() || model.length > 256 || /\s/.test(model))) {
      setModelStatus(t('ui.invalid.model.id'))
      return false
    }
    if (new Set(models).size !== models.length) {
      setModelStatus(t('ui.duplicate.model.id'))
      return false
    }
    const next = { ...modelLists, [provider]: models }
    setModelListBusy(true)
    try {
      await persistModelLists(next)
      setModelStatus(t('ui.provider.models.saved.locally'))
      return true
    } catch (cause) {
      setModelStatus(t('ui.failed.to.save.provider.models.arg', String(cause)))
      return false
    } finally { setModelListBusy(false) }
  }

  async function addProvider() {
    if (!newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()) return
    if (customEndpoints.some(endpoint => normalizedEndpoint(endpoint.base_url) === normalizedEndpoint(newProviderUrl))) {
      setProviderFormError(t('ui.provider.endpoint.already.exists'))
      return
    }
    setModelBusy(true)
    try {
      await models.addEndpoint({ name: newProviderName.trim(), baseUrl: newProviderUrl.trim(), model: newProviderModel.trim(), apiKey: newProviderKey })
      setAddingProvider(false)
      setNewProviderPreset('')
      setProviderFormError('')
      setNewProviderName('')
      setNewProviderUrl('')
      setNewProviderModel('')
      setModelSuggestionsOpen(false)
      setModelSuggestionQuery('')
      setNewProviderKey('')
      await loadModelOptions(true)
      setModelStatus(t('ui.provider.added'))
    } catch (cause) { setProviderFormError(t('ui.provider.add.failed.arg', String(cause))) }
    finally { setModelBusy(false) }
  }

  function chooseProviderPreset(value: string) {
    setNewProviderPreset(value)
    setProviderFormError('')
    setModelSuggestionsOpen(false)
    setModelSuggestionQuery('')
    if (!value) {
      setNewProviderName('')
      setNewProviderUrl('')
      setNewProviderModel('')
      return
    }
    const preset = VOLCENGINE_PRESETS.find(item => `preset:${item.id}` === value)
    const provider = modelProviders.find(item => item.slug === value)
    setNewProviderName(preset ? t(preset.name) : provider?.name || '')
    setNewProviderUrl(preset?.baseUrl || provider?.api_url || '')
    setNewProviderModel(preset?.models[0] || provider?.models[0] || MODEL_FALLBACKS[value]?.[0] || '')
  }

  async function deleteProvider(endpoint: CustomEndpoint) {
    if (endpoint.source === 'direct-config' || (endpoint.is_current && savedModel?.provider === 'custom')) {
      setModelStatus(t('ui.switch.default.before.deleting.provider'))
      return
    }
    if (!window.confirm(t('ui.delete.provider.confirm.arg', endpoint.name))) return
    setModelBusy(true)
    try {
      await models.deleteEndpoint(endpoint.id)
      if (modelProvider === endpoint.id) setModelFormOpen(false)
      await loadModelOptions(false)
      setModelStatus(t('ui.provider.deleted'))
    } catch (cause) { setModelStatus(t('ui.provider.delete.failed.arg', String(cause))) }
    finally { setModelBusy(false) }
  }

  async function saveModel(confirm = false) {
    if (!modelProvider.trim() || !modelName.trim()) return
    setModelBusy(true)
    setModelStatus(t("ui.saving.model.configuration"))
    try {
      const result = await models.setDefault({
        provider: selectedPreset ? 'custom' : modelProvider.trim(), model: modelName.trim(),
        baseUrl: modelBaseUrl.trim(), apiKey: modelKey,
        confirmExpensiveModel: confirm,
      })
      if (result.confirm_required) {
        setModelConfirmation(result.confirm_message || t("ui.this.model.needs.confirmation"))
        setModelStatus(t("ui.please.confirm.model.selection"))
      } else if (result.ok) {
        setModelConfirmation('')
        setModelKey('')
        setSavedModel({
          provider: result.provider || (selectedPreset ? 'custom' : modelProvider),
          model: result.model || modelName,
          name: selectedPreset?.name || modelProviders.find(provider => provider.slug === modelProvider)?.name || modelProvider,
          baseUrl: modelBaseUrl.trim(),
        })
        setModelOptionsLoaded(true)
        setModelStatus(t("ui.saved.arg.arg.applies.to.new.sessions", selectedPreset ? t(selectedPreset.name) : result.provider || modelProvider, result.model || modelName))
      } else {
        setModelStatus(t("ui.model.configuration.not.accepted.by.backend"))
      }
    } catch (cause) { setModelStatus(t("ui.failed.to.save.model.arg", String(cause))) }
    finally { setModelBusy(false) }
  }

  async function checkModel() {
    setModelBusy(true)
    try {
      const result = await models.checkRuntime()
      setModelStatus(result.ok ? t("ui.runtime.recognized.arg.arg", result.provider || '', result.model || '')
        : t("ui.runtime.not.ready.arg", result.error || t("ui.check.the.key.and.model.settings")))
    } catch (cause) { setModelStatus(t("ui.check.model.failed.arg", String(cause))) }
    finally { setModelBusy(false) }
  }

  async function openModelPicker(refresh = true) {
    if (!backend) return
    setModelPickerOpen(true)
    setPickerBusy(true)
    setPickerError('')
    try {
      const result = await models.options({
        refresh, includeUnconfigured: false, sessionId: sessionRef.current || undefined,
      })
      const providers = (result.providers || []).filter(row => desktopModelProviderSupported(row.slug) && row.authenticated !== false)
      setPickerProviders(providers)
      setActiveModel(result.model && result.provider ? { provider: result.provider, model: result.model } : null)
      setPickerProvider(current => providers.some(row => row.slug === current) ? current
        : providers.find(row => row.slug === result.provider)?.slug || providers[0]?.slug || '')
    } catch (cause) { setPickerError(String(cause)) }
    finally { setPickerBusy(false) }
  }

  async function pickModel(provider: string, model: string, remember = false, confirm?: string) {
    if (!provider || !model.trim() || pickerBusy || turnBusy) return
    setPickerBusy(true)
    setPickerError('')
    try {
      const id = await ensureChatSession()
      const result = await models.selectChat({ sessionId: id, provider, model: model.trim(), confirm })
      if (result.confirm_required && result.confirm) {
        setPickerConfirmation({ provider, model: model.trim(), remember, token: result.confirm, message: result.confirm_message || t('ui.please.confirm.model.selection') })
        return
      }
      if (!result.model || result.status === 'refused') throw new Error(t('ui.model.switch.not.applied'))
      setActiveModel({ provider: result.provider || provider, model: result.model })
      setPickerConfirmation(null)
      let remembered = true
      if (remember) {
        const pickerRow = pickerProviders.find(row => row.slug === provider)
        const endpoint = customEndpoints.find(item => item.id === provider || (pickerRow?.api_url && normalizedEndpoint(item.base_url) === normalizedEndpoint(pickerRow.api_url)))
        const modelListKey = endpoint?.id || provider
        const savedList = savedCandidates(provider, pickerProviders)
        if (savedList) {
          const next = { ...modelLists, [modelListKey]: [...new Set([...savedList, model.trim()])] }
          try { await persistModelLists(next) }
          catch { remembered = false }
        } else {
          const next = { ...addedModels, [provider]: [...new Set([...(addedModels[provider] || []), model.trim()])] }
          try { localStorage.setItem(`${ADDED_MODELS_KEY}:${storagePath}`, JSON.stringify(next)); setAddedModels(next) }
          catch { remembered = false }
        }
        setPickerModelInput('')
      }
      setChatStatus(remembered ? t('ui.model.switched.for.session.arg', result.model) : t('ui.failed.to.save.model.id'))
      setModelPickerOpen(false)
    } catch (cause) { setPickerError(String(cause)) }
    finally { setPickerBusy(false) }
  }


  function resetModel() {
    setSavedModel(null)
    setModelOptionsLoaded(false)
    setModelOptionsError('')
    setModelPickerOpen(false)
  }

  return {
    modelProviders, configuredProviders, customEndpoints, addingProvider, setAddingProvider,
    newProviderPreset, providerFormError, setProviderFormError, newProviderName, setNewProviderName,
    newProviderUrl, setNewProviderUrl, newProviderModel, setNewProviderModel,
    modelSuggestionsOpen, setModelSuggestionsOpen, modelSuggestionQuery, setModelSuggestionQuery,
    newProviderKey, setNewProviderKey, modelFormOpen, setModelFormOpen, modelProvider,
    modelName, setModelName, modelBaseUrl, setModelBaseUrl, modelKey, setModelKey,
    modelBusy, modelStatus, modelConfirmation, setModelConfirmation,
    modelOptionsLoaded, modelOptionsError, savedModel, setSavedModel,
    modelPickerOpen, setModelPickerOpen, modelButtonRef, modelPickerRef, pickerPosition,
    pickerProviders, pickerProvider, setPickerProvider, pickerModelInput, setPickerModelInput,
    pickerBusy, pickerError, pickerConfirmation, addedModels, modelLists, modelListBusy,
    modelListLoading, selectedPreset, backendCandidates, fallbackCandidates, modelCandidates,
    pickerModels, newProviderPresetModels, visibleProviderModels, providerCards,
    loadModelOptions, selectModelProvider, saveProviderModels, addProvider, chooseProviderPreset,
    deleteProvider, saveModel, checkModel, openModelPicker, pickModel, resetModel,
  }
}
