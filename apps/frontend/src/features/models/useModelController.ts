import React from 'react'
import type { BackendInfo, ProfileScope, SessionScope } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileRef, useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { appendModelIds, desktopModelProviderSupported, endpointForProvider, normalizedEndpoint, readAddedModels, readModelLists, modelStorageKey, VOLCENGINE_PRESETS, savedModelFromOptions, ADDED_MODELS_KEY, MODEL_LISTS_KEY, type ModelProvider, type CustomEndpoint, type ModelPick, type SavedModel } from './model'

type Options = {
  backend: BackendInfo | null
  profile: string | null
  storagePath: string
  t: (key: string, ...values: unknown[]) => string
  sessionRef: React.RefObject<string>
  sessionProfileRef: React.RefObject<string>
  turnBusy: boolean
  setChatStatus: React.Dispatch<React.SetStateAction<string>>
  setActiveModel: React.Dispatch<React.SetStateAction<ModelPick | null>>
}

export function useModelController({ backend, profile, storagePath, t, sessionRef, sessionProfileRef, turnBusy, setChatStatus, setActiveModel }: Options) {
  const { models } = useDesktop()
  const workspace = workspaceKey(backend?.replay_epoch, profile)
  let stateSlot = 0
  const useState = <T,>(initial: T | (() => T)) => useProfileState(workspace, initial, `models:${stateSlot++}`)
  const useRef = <T,>(initial: T) => useProfileRef(workspace, initial)
  const profileRef = useRef(profile)
  profileRef.current = profile
  function profileScope(): ProfileScope {
    const owner = profileRef.current
    if (!owner) throw new Error('No active Profile')
    return { kind: 'profile', profile: owner }
  }
  function sessionScope(id: string): SessionScope {
    if (!id || !sessionProfileRef.current) throw new Error('Session has no Profile owner')
    return { kind: 'session', profile: sessionProfileRef.current, sessionId: id }
  }
  const language = useLanguage()
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([])
  const [configuredProviders, setConfiguredProviders] = useState<ModelProvider[]>([])
  const [customEndpoints, setCustomEndpoints] = useState<CustomEndpoint[]>([])
  const [addingProvider, setAddingProvider] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<CustomEndpoint | null>(null)
  const [newProviderPreset, setNewProviderPreset] = useState('')
  const [providerFormError, setProviderFormError] = useState('')
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderUrl, setNewProviderUrl] = useState('')
  const [newProviderModel, setNewProviderModel] = useState('')
  const [newProviderKey, setNewProviderKey] = useState('')
  const [clearProviderKey, setClearProviderKey] = useState(false)
  const [newProviderMakeDefault, setNewProviderMakeDefault] = useState(true)
  const [newProviderDiscoverModels, setNewProviderDiscoverModels] = useState(true)
  const [modelFormOpen, setModelFormOpen] = useState(false)
  const [modelProvider, setModelProvider] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelBaseUrl, setModelBaseUrl] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [modelBusy, setModelBusy] = useState(false)
  const [modelStatus, setModelStatus] = useState('')
  const [modelConfirmation, setModelConfirmation] = useState('')
  const [modelOptionsLoaded, setModelOptionsLoaded] = useState(false)
  const [modelOptionsError, setModelOptionsError] = useState('')
  const [savedModel, setSavedModel] = useState<SavedModel | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const modelButtonRef = useRef<HTMLButtonElement | null>(null)
  const modelPickerRef = useRef<HTMLDivElement | null>(null)
  const [pickerPosition, setPickerPosition] = useState<React.CSSProperties>({})
  const [pickerProviders, setPickerProviders] = useState<ModelProvider[]>([])
  const [pickerProvider, setPickerProvider] = useState('')
  const [pickerModelInput, setPickerModelInput] = useState('')
  const [pickerBusy, setPickerBusy] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const [pickerConfirmation, setPickerConfirmation] = useState<{ provider: string; model: string; remember: boolean; token: string; message: string } | null>(null)
  const [addedModels, setAddedModels] = useState<Record<string, string[]>>({})
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({})
  const [modelListBusy, setModelListBusy] = useState(false)
  const [discoveryBusy, setDiscoveryBusy] = useState('')
  const [modelListLoading, setModelListLoading] = useState(true)
  const modelOptionsRequestRef = useRef(0)
  React.useEffect(() => {
    if (!profile) return
    const scope: ProfileScope = { kind: 'profile', profile }
    setAddedModels(readAddedModels(storagePath, profile))
    const legacyLists = readModelLists(storagePath, profile)
    setModelLists(legacyLists)
    if (!storagePath) return
    let active = true
    setModelListLoading(true)
    void models.loadLists(scope, storagePath).then(saved => {
      if (!active) return
      if (saved !== null) setModelLists(saved)
      else if (Object.keys(legacyLists).length) return models.saveLists(scope, storagePath, legacyLists)
    }).catch(cause => { if (active) setModelStatus(t('ui.failed.to.save.provider.models.arg', describeError(cause, language))) })
      .finally(() => { if (active) setModelListLoading(false) })
    return () => { active = false }
  }, [storagePath, profile])
  const selectedPreset = VOLCENGINE_PRESETS.find(preset => preset.id === modelProvider)
  function savedCandidates(slug: string): string[] | undefined {
    const endpoint = endpointForProvider({ slug }, customEndpoints)
    return modelLists[endpoint?.id || slug] ?? modelLists[slug]
      ?? (endpoint ? modelLists[`custom:${endpoint.name.toLowerCase().replace(/\s+/g, '-')}`] : undefined)
  }
  function visibleModels(slug: string): string[] {
    const endpoint = endpointForProvider({ slug }, customEndpoints)
    const current = savedModel && (savedModel.provider === slug || endpoint?.is_current) ? savedModel.model : ''
    const saved = savedCandidates(slug)
    return [...new Set([...(saved ?? [endpoint?.model || '', ...(addedModels[slug] || [])]), current || ''].filter(Boolean))]
  }
  const modelCandidates = visibleModels(modelProvider)
  const pickerModels = visibleModels(pickerProvider)
  const savedPreset = savedModel?.provider === 'custom'
    ? VOLCENGINE_PRESETS.find(preset => normalizedEndpoint(preset.baseUrl) === normalizedEndpoint(savedModel.baseUrl))
    : undefined
  const providerCards = configuredProviders
    .filter(provider => desktopModelProviderSupported(provider.slug) && (provider.slug !== 'custom' || !savedPreset))
    .map(provider => ({ slug: provider.slug, name: provider.name, api_url: provider.api_url || '', is_user_defined: Boolean(provider.is_user_defined), is_current: provider.is_current, models: [] as string[] }))
  if (savedModel?.provider && desktopModelProviderSupported(savedModel.provider)
    && !providerCards.some(provider => provider.slug === (savedPreset?.id || savedModel.provider) || provider.is_current)
    && !customEndpoints.some(endpoint => endpoint.source !== 'direct-config' && endpoint.is_current)) {
    providerCards.unshift({ slug: savedPreset?.id || savedModel.provider, name: t(savedModel.name), api_url: savedModel.baseUrl, is_user_defined: savedModel.provider === 'custom', is_current: true, models: [] })
  }
  const representedEndpointIds = new Set(providerCards.map(provider => endpointForProvider(provider, customEndpoints)?.id).filter(Boolean))
  for (const endpoint of customEndpoints) {
    if (endpoint.source === 'direct-config' || representedEndpointIds.has(endpoint.id)) continue
    providerCards.push({ slug: endpoint.id, name: endpoint.name, api_url: endpoint.base_url, is_user_defined: true, is_current: endpoint.is_current, models: [] })
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
      ? { left, bottom: window.innerHeight - rect.top + 8, height: Math.min(390, Math.max(120, above - 8)) }
      : { left, top: rect.bottom + 8, height: Math.min(390, Math.max(120, below - 8)) })
  }, [workspace])

  React.useLayoutEffect(() => {
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
  async function loadModelOptions() {
    const request = ++modelOptionsRequestRef.current
    setModelBusy(true)
    setModelOptionsError('')
    setModelStatus(t("ui.loading.model.options"))
    try {
      const scope = profileScope()
      const configPromise = models.savedConfig(scope)
      void configPromise.then(config => {
        if (request === modelOptionsRequestRef.current) {
          setSavedModel(savedModelFromOptions({ providers: [] }, config))
        }
      }).catch(() => { /* Model options may still provide the default. */ })
      const [optionsResult, configuredResult, configResult, endpointsResult] = await Promise.allSettled([
        models.options(scope, { refresh: false }),
        models.options(scope, { refresh: false, includeUnconfigured: false }),
        configPromise,
        models.endpoints(scope),
      ])
      if (request !== modelOptionsRequestRef.current) return
      if (optionsResult.status === 'rejected' && configResult.status === 'rejected') throw configResult.reason
      const result = optionsResult.status === 'fulfilled' ? optionsResult.value : { providers: [] }
      const config = configResult.status === 'fulfilled' ? configResult.value : { provider: '', model: '', base_url: '' }
      if (endpointsResult.status === 'fulfilled') setCustomEndpoints(endpointsResult.value.endpoints || [])
      const availableProviders = (result.providers || []).filter(provider => desktopModelProviderSupported(provider.slug))
      setModelProviders(availableProviders)
      if (configuredResult.status === 'fulfilled') {
        setConfiguredProviders((configuredResult.value.providers || []).filter(provider => desktopModelProviderSupported(provider.slug) && provider.authenticated !== false))
      }
      const displayOptions = { ...result, providers: configuredResult.status === 'fulfilled' ? configuredResult.value.providers : [] }
      const saved = savedModelFromOptions(displayOptions, config)
      setSavedModel(saved)
      setModelOptionsLoaded(true)
      const preset = saved?.provider === 'custom'
        ? VOLCENGINE_PRESETS.find(item => item.baseUrl.replace(/\/$/, '').toLowerCase() === saved.baseUrl.replace(/\/$/, '').toLowerCase())
        : undefined
      const savedProviderSupported = saved?.provider && desktopModelProviderSupported(saved.provider)
      setModelProvider(preset?.id || (savedProviderSupported ? saved.provider : '') || availableProviders[0]?.slug || 'custom')
      setModelName(savedProviderSupported ? saved.model : '')
      setModelBaseUrl(saved?.provider === 'custom' ? saved.baseUrl : '')
      const failed = [optionsResult, configuredResult, configResult, endpointsResult].find(item => item.status === 'rejected')
      setModelStatus(failed?.status === 'rejected'
        ? t('ui.failed.to.load.model.options.arg', describeError(failed.reason, language)) : '')
    } catch (cause) {
      if (request === modelOptionsRequestRef.current) {
        setModelOptionsError(describeError(cause, language))
        setModelStatus(t("ui.failed.to.load.model.options.arg", describeError(cause, language)))
      }
    }
    finally { if (request === modelOptionsRequestRef.current) setModelBusy(false) }
  }

  function selectModelProvider(provider: string, model = '', fresh = false) {
    const preset = VOLCENGINE_PRESETS.find(row => row.id === provider)
    setModelProvider(provider)
    setModelName(model)
    setModelBaseUrl(preset?.baseUrl || (!fresh && savedModel?.provider === provider ? savedModel.baseUrl : ''))
    setModelConfirmation('')
    setModelStatus('')
    setModelFormOpen(true)
  }

  async function persistModelLists(next: Record<string, string[]>) {
    const scope = profileScope()
    await models.saveLists(scope, storagePath, next)
    setModelLists(next)
    try { localStorage.setItem(`${MODEL_LISTS_KEY}:${modelStorageKey(storagePath, scope.profile)}`, JSON.stringify(next)) } catch { /* Native storage is authoritative. */ }
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
      setModelStatus(t('ui.failed.to.save.provider.models.arg', describeError(cause, language)))
      return false
    } finally { setModelListBusy(false) }
  }

  async function setProviderDiscovery(endpoint: CustomEndpoint, enabled: boolean) {
    if (discoveryBusy || modelListBusy || endpoint.source === 'direct-config') return
    setDiscoveryBusy(endpoint.id)
    try {
      await models.setEndpointDiscovery(profileScope(), endpoint.id, enabled)
      const updated = await models.endpoints(profileScope()).catch(() => null)
      setCustomEndpoints(current => updated?.endpoints || current.map(item => item.id === endpoint.id ? { ...item, discover_models: enabled } : item))
      setModelStatus(t('ui.provider.discovery.saved'))
    } catch (cause) {
      setModelStatus(t('ui.provider.discovery.failed.arg', describeError(cause, language)))
    } finally { setDiscoveryBusy('') }
  }

  async function syncProviderModels(provider: string, modelListKey: string): Promise<void> {
    if (discoveryBusy || modelListBusy || modelListLoading) return
    setDiscoveryBusy(modelListKey)
    setModelListBusy(true)
    try {
      const result = await models.options(profileScope(), { refresh: true, includeUnconfigured: false })
      const row = result.providers.find(item => item.slug === provider)
      if (!row?.models?.length) throw new Error(t('ui.provider.sync.no.catalog'))
      const previous = visibleModels(provider)
      const nextIds = appendModelIds(previous, row.models || [])
      if (nextIds.length > previous.length) {
        await persistModelLists({ ...modelLists, [modelListKey]: nextIds })
      }
      setModelStatus(t('ui.provider.sync.finished.arg', nextIds.length - previous.length))
    } catch (cause) {
      setModelStatus(t('ui.provider.sync.failed.arg', describeError(cause, language)))
    } finally { setDiscoveryBusy(''); setModelListBusy(false) }
  }

  async function addProvider() {
    if (!newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()) return
    if (customEndpoints.some(endpoint => normalizedEndpoint(endpoint.base_url) === normalizedEndpoint(newProviderUrl))) {
      setProviderFormError(t('ui.provider.endpoint.already.exists'))
      return
    }
    setModelBusy(true)
    try {
      await models.addEndpoint(profileScope(), { name: newProviderName.trim(), baseUrl: newProviderUrl.trim(), model: newProviderModel.trim(), apiKey: newProviderKey, makeDefault: newProviderMakeDefault, discoverModels: newProviderDiscoverModels })
      setAddingProvider(false)
      setNewProviderPreset('')
      setProviderFormError('')
      setNewProviderName('')
      setNewProviderUrl('')
      setNewProviderModel('')
      setNewProviderKey('')
      setNewProviderMakeDefault(true)
      setNewProviderDiscoverModels(true)
      await loadModelOptions()
      setModelStatus(t('ui.provider.added'))
    } catch (cause) { setProviderFormError(t('ui.provider.add.failed.arg', describeError(cause, language))) }
    finally { setModelBusy(false) }
  }

  function openProviderEditor(endpoint: CustomEndpoint) {
    setEditingEndpoint(endpoint)
    setNewProviderPreset('')
    setNewProviderName(endpoint.name)
    setNewProviderUrl(endpoint.base_url)
    setNewProviderModel(endpoint.model)
    setNewProviderKey('')
    setClearProviderKey(false)
    setNewProviderMakeDefault(endpoint.is_current)
    setNewProviderDiscoverModels(endpoint.discover_models !== false)
    setProviderFormError('')
    setAddingProvider(true)
  }

  async function updateProvider() {
    const endpoint = editingEndpoint
    if (!endpoint || !newProviderName.trim() || !newProviderUrl.trim() || !newProviderModel.trim()) return
    if (customEndpoints.some(item => item.id !== endpoint.id && normalizedEndpoint(item.base_url) === normalizedEndpoint(newProviderUrl))) {
      setProviderFormError(t('ui.provider.endpoint.already.exists'))
      return
    }
    setModelBusy(true)
    try {
      await models.updateEndpoint(profileScope(), {
        endpointId: endpoint.id, name: newProviderName.trim(), baseUrl: newProviderUrl.trim(),
        model: newProviderModel.trim(), apiKey: clearProviderKey ? '' : newProviderKey.trim() || null,
        makeDefault: endpoint.is_current || newProviderMakeDefault,
        discoverModels: newProviderDiscoverModels,
      })
      setAddingProvider(false)
      setEditingEndpoint(null)
      setNewProviderKey('')
      setClearProviderKey(false)
      setProviderFormError('')
      await loadModelOptions()
      setModelStatus(t('ui.provider.updated'))
    } catch (cause) { setProviderFormError(t('ui.provider.update.failed.arg', describeError(cause, language))) }
    finally { setModelBusy(false) }
  }

  function chooseProviderPreset(value: string) {
    setNewProviderPreset(value)
    setProviderFormError('')
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
    setNewProviderModel(preset?.defaultModel || '')
  }

  async function deleteProvider(endpoint: CustomEndpoint) {
    const confirmKey = endpoint.source === 'direct-config'
      ? 'ui.delete.direct.provider.confirm.arg'
      : 'ui.delete.provider.confirm.arg'
    if (!window.confirm(t(confirmKey, endpoint.name))) return
    setModelBusy(true)
    try {
      await models.deleteEndpoint(profileScope(), endpoint.id)
      if (modelProvider === endpoint.id) setModelFormOpen(false)
      await loadModelOptions()
      setModelStatus(t('ui.provider.deleted'))
    } catch (cause) { setModelStatus(t('ui.provider.delete.failed.arg', describeError(cause, language))) }
    finally { setModelBusy(false) }
  }

  async function saveModel(confirm = false) {
    if (!modelProvider.trim() || !modelName.trim()) return false
    setModelBusy(true)
    setModelStatus(t("ui.saving.model.configuration"))
    try {
      const result = await models.setDefault(profileScope(), {
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
        return true
      } else {
        setModelStatus(t("ui.model.configuration.not.accepted.by.backend"))
      }
    } catch (cause) { setModelStatus(t("ui.failed.to.save.model.arg", describeError(cause, language))) }
    finally { setModelBusy(false) }
    return false
  }

  async function saveProviderDefault(provider: string, model: string, baseUrl: string, confirm = false): Promise<'saved' | 'confirm' | 'error'> {
    if (!provider.trim() || !model.trim()) return 'error'
    setModelBusy(true)
    try {
      const result = await models.setDefault(profileScope(), {
        provider: provider.trim(), model: model.trim(), baseUrl: baseUrl.trim(), apiKey: '', confirmExpensiveModel: confirm,
      })
      if (result.confirm_required) {
        setModelStatus(result.confirm_message || t('ui.this.model.needs.confirmation'))
        return 'confirm'
      }
      if (!result.ok) throw new Error(t('ui.model.configuration.not.accepted.by.backend'))
      setSavedModel({ provider: result.provider || provider, model: result.model || model,
        name: providerCards.find(item => item.slug === provider)?.name || provider, baseUrl: baseUrl.trim() })
      setModelStatus(t('ui.saved.arg.arg.applies.to.new.sessions', result.provider || provider, result.model || model))
      return 'saved'
    } catch (cause) {
      setModelStatus(t('ui.failed.to.save.model.arg', describeError(cause, language)))
      return 'error'
    } finally { setModelBusy(false) }
  }

  async function checkModel() {
    setModelBusy(true)
    try {
      const result = await models.checkRuntime(profileScope())
      setModelStatus(result.ok ? t("ui.runtime.recognized.arg.arg", result.provider || '', result.model || '')
        : t("ui.runtime.not.ready.arg", t("ui.check.the.key.and.model.settings")))
    } catch (cause) { setModelStatus(t("ui.check.model.failed.arg", describeError(cause, language))) }
    finally { setModelBusy(false) }
  }

  async function openModelPicker() {
    if (!backend) return
    setModelPickerOpen(true)
    setPickerBusy(true)
    setPickerError('')
    try {
      const scope = sessionRef.current ? sessionScope(sessionRef.current) : profileScope()
      const result = await models.options(scope, { refresh: false, includeUnconfigured: false })
      const providers = (result.providers || []).filter(row => desktopModelProviderSupported(row.slug) && row.authenticated !== false)
      setPickerProviders(providers)
      if (sessionRef.current) {
        setActiveModel(result.model && result.provider ? { provider: result.provider, model: result.model } : null)
      }
      setPickerProvider(current => providers.some(row => row.slug === current) ? current
        : providers.find(row => row.slug === result.provider)?.slug || providers[0]?.slug || '')
    } catch (cause) { setPickerError(describeError(cause, language)) }
    finally { setPickerBusy(false) }
  }

  async function pickModel(provider: string, model: string, remember = false, confirm?: string) {
    if (!provider || !model.trim() || pickerBusy || turnBusy) return
    setPickerBusy(true)
    setPickerError('')
    try {
      const result = sessionRef.current
        ? await models.selectChat(sessionScope(sessionRef.current), { provider, model: model.trim(), confirm })
        : { provider, model: model.trim(), status: 'selected' }
      if (result.confirm_required && result.confirm) {
        setPickerConfirmation({ provider, model: model.trim(), remember, token: result.confirm, message: result.confirm_message || t('ui.please.confirm.model.selection') })
        return
      }
      if (!result.model || result.status === 'refused') throw new Error(t('ui.model.switch.not.applied'))
      setActiveModel({ provider: result.provider || provider, model: result.model })
      setPickerConfirmation(null)
      let remembered = true
      if (remember) {
        const endpoint = endpointForProvider({ slug: provider }, customEndpoints)
        const modelListKey = endpoint?.id || provider
        const savedList = savedCandidates(provider)
        if (savedList) {
          const next = { ...modelLists, [modelListKey]: [...new Set([...savedList, model.trim()])] }
          try { await persistModelLists(next) }
          catch { remembered = false }
        } else {
          const next = { ...addedModels, [provider]: [...new Set([...(addedModels[provider] || []), model.trim()])] }
          try { localStorage.setItem(`${ADDED_MODELS_KEY}:${modelStorageKey(storagePath, sessionProfileRef.current || profileRef.current || '')}`, JSON.stringify(next)); setAddedModels(next) }
          catch { remembered = false }
        }
        setPickerModelInput('')
      }
      setChatStatus(remembered
        ? sessionRef.current ? t('ui.model.switched.for.session.arg', result.model) : t('ui.model.selected.for.new.session.arg', result.model)
        : t('ui.failed.to.save.model.id'))
      setModelPickerOpen(false)
    } catch (cause) { setPickerError(describeError(cause, language)) }
    finally { setPickerBusy(false) }
  }


  function resetModel() {
    setSavedModel(null)
    setModelOptionsLoaded(false)
    setModelOptionsError('')
    setModelPickerOpen(false)
  }

  return {
    modelProviders, configuredProviders, customEndpoints, addingProvider, setAddingProvider, editingEndpoint, setEditingEndpoint,
    newProviderPreset, setNewProviderPreset, providerFormError, setProviderFormError, newProviderName, setNewProviderName,
    newProviderUrl, setNewProviderUrl, newProviderModel, setNewProviderModel,
    newProviderMakeDefault, setNewProviderMakeDefault, newProviderDiscoverModels, setNewProviderDiscoverModels,
    newProviderKey, setNewProviderKey, clearProviderKey, setClearProviderKey, modelFormOpen, setModelFormOpen, modelProvider,
    modelName, setModelName, modelBaseUrl, setModelBaseUrl, modelKey, setModelKey,
    modelBusy, modelStatus, modelConfirmation, setModelConfirmation,
    modelOptionsLoaded, modelOptionsError, savedModel, setSavedModel,
    modelPickerOpen, setModelPickerOpen, modelButtonRef, modelPickerRef, pickerPosition,
    pickerProviders, pickerProvider, setPickerProvider, pickerModelInput, setPickerModelInput,
    pickerBusy, pickerError, pickerConfirmation, addedModels, modelLists, modelListBusy,
    modelListLoading, discoveryBusy, selectedPreset, modelCandidates, pickerModels, providerCards, visibleModels,
    loadModelOptions, selectModelProvider, saveProviderModels, saveProviderDefault, setProviderDiscovery, syncProviderModels, addProvider, updateProvider, openProviderEditor, chooseProviderPreset,
    deleteProvider, saveModel, checkModel, openModelPicker, pickModel, resetModel,
  }
}
