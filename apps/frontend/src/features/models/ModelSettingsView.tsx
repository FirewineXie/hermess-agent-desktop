import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { localizeAppMessage } from '../../i18n'
import { endpointForProvider, VOLCENGINE_PRESETS, type CustomEndpoint } from './model'
import ProviderCard from './components/ProviderCard'
import type { useModelController } from './useModelController'
import type { ProviderSyncResult } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'

type Props = {
  connected: boolean
  profile: string | null
  language: 'zh-CN' | 'en-US'
  t: (key: string, ...values: unknown[]) => string
  controller: ReturnType<typeof useModelController>
  onOpenRuntime: () => void
  profiles?: Array<{ name: string; display_name?: string }>
}

const syncFieldLabels: Record<string, [string, string]> = {
  name: ['名称', 'name'], base_url: ['接口地址', 'endpoint URL'], model: ['默认模型', 'default model'],
  api_mode: ['API 模式', 'API mode'], context_length: ['上下文长度', 'context length'],
  discover_models: ['模型发现', 'model discovery'], models: ['模型目录', 'model catalog'],
  credential: ['目标已有凭据会被清除', 'existing target credential will be cleared'],
}

function syncConflictDescription(item: ProviderSyncResult['targets'][number], language: Props['language']): string {
  const kind = ({
    id: ['提供商 ID 相同', 'same provider ID'],
    name: ['提供商名称相同', 'same provider name'],
    address: ['接口地址相同但名称不同，不能自动覆盖', 'same endpoint URL with a different name; cannot replace automatically'],
  } as const)[item.conflictKind || 'name'][language === 'zh-CN' ? 0 : 1]
  const fields = (item.changedFields || []).map(key => syncFieldLabels[key]?.[language === 'zh-CN' ? 0 : 1] || key)
  return fields.length ? `${kind} · ${language === 'zh-CN' ? '差异' : 'Differences'}：${fields.join(language === 'zh-CN' ? '、' : ', ')}` : kind
}

export default function ModelSettingsView({ connected, profile, language, t, controller, onOpenRuntime, profiles = [] }: Props) {
  const { models: modelApi } = useDesktop()
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
  const [syncEndpoint, setSyncEndpoint] = useState<CustomEndpoint | null>(null)
  const [syncTargets, setSyncTargets] = useState<string[]>([])
  const [syncReplace, setSyncReplace] = useState(false)
  const [syncResult, setSyncResult] = useState<ProviderSyncResult | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState('')
  const syncRun = useRef(0)
  useEffect(() => {
    syncRun.current += 1
    setSyncEndpoint(null)
    setSyncTargets([])
    setSyncReplace(false)
    setSyncResult(null)
    setSyncBusy(false)
    setSyncError('')
  }, [profile])
  const availableSyncTargets = profiles.filter(item => item.name !== profile)
  const runProviderSync = async (apply: boolean) => {
    if (!profile || !syncEndpoint || syncTargets.length === 0) return
    const request = ++syncRun.current
    setSyncBusy(true)
    setSyncError('')
    try {
      const result = await modelApi.syncProvider({ kind: 'profile', profile }, { endpointId: syncEndpoint.id, targetProfiles: syncTargets, apply, replaceConflicts: syncReplace })
      if (request !== syncRun.current) return
      setSyncResult(result)
      if (apply) await loadModelOptions()
    } catch (error) { if (request === syncRun.current) setSyncError(describeError(error, language)) }
    finally { if (request === syncRun.current) setSyncBusy(false) }
  }
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
            onSyncModels={() => void syncProviderModels(provider.slug, modelListKey)} onSyncProvider={availableSyncTargets.length ? endpoint => { setSyncEndpoint(endpoint); setSyncTargets([]); setSyncReplace(false); setSyncResult(null); setSyncError('') } : undefined} />
        })}</div>
      </div>}
      {syncEndpoint && <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !syncBusy) setSyncEndpoint(null) }}><div className="provider-add-form provider-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-sync-title" onKeyDown={event => { trapDialogFocus(event); if (event.key === 'Escape' && !syncBusy) setSyncEndpoint(null) }}>
        <div className="row model-editor-heading"><div><h2 id="provider-sync-title">{language === 'zh-CN' ? `同步 ${syncEndpoint.name} 到其他 Profile` : `Sync ${syncEndpoint.name} to other Profiles`}</h2><p>{language === 'zh-CN' ? '复制提供商配置，不会修改目标 Profile 的主模型、回退链或辅助模型。' : 'Copies provider configuration without changing the target Profile model assignments.'}</p></div><button type="button" aria-label={t('ui.close')} disabled={syncBusy} onClick={() => setSyncEndpoint(null)}>×</button></div>
        <div className="provider-sync-source"><span>{language === 'zh-CN' ? '来源 Profile' : 'Source Profile'}</span><strong>{profile}</strong></div>
        <fieldset><legend>{language === 'zh-CN' ? '选择目标 Profile' : 'Select target Profiles'}</legend>{availableSyncTargets.map(item => <label key={item.name}><input type="checkbox" checked={syncTargets.includes(item.name)} disabled={syncBusy} onChange={event => { setSyncTargets(current => event.target.checked ? [...current, item.name] : current.filter(name => name !== item.name)); setSyncResult(null); setSyncReplace(false) }} /><span><strong>{item.display_name || item.name}</strong><small>{item.name}</small></span></label>)}</fieldset>
        <p className="provider-sync-warning">{language === 'zh-CN' ? '锁定运行时没有安全的凭据导出接口。本次只复制 Endpoint、API 模式和模型配置；目标 Profile 需要重新认证。' : 'The locked runtime has no export-safe credential API. Endpoint and model configuration are copied; target Profiles must authenticate again.'}</p>
        {syncResult && <ul className="provider-sync-results">{syncResult.targets.map(item => <li key={item.profile}><strong>{item.profile}</strong><span>{({ ready: language === 'zh-CN' ? '可以复制' : 'Ready', conflict: language === 'zh-CN' ? '存在冲突' : 'Conflict', copied: language === 'zh-CN' ? '配置已复制，需要重新认证' : 'Configuration copied; authentication required', unverified: language === 'zh-CN' ? '写入后未能核实，请检查目标 Profile，避免重复提交' : 'Could not verify after writing; check the target Profile before retrying', failed: language === 'zh-CN' ? '复制失败' : 'Copy failed' })[item.status]}{item.status === 'conflict' && <small>{syncConflictDescription(item, language)}</small>}</span></li>)}</ul>}
        {syncResult?.targets.some(item => item.status === 'conflict') && <label className="provider-make-default"><input type="checkbox" checked={syncReplace} onChange={event => setSyncReplace(event.target.checked)} />{language === 'zh-CN' ? '明确替换目标中冲突的可迁移字段' : 'Explicitly replace conflicting transferable fields'}</label>}
        {syncError && <p role="alert">{syncError}</p>}
        <div className="actions"><button type="button" disabled={syncBusy || syncTargets.length === 0} onClick={() => void runProviderSync(false)}>{language === 'zh-CN' ? '检查冲突' : 'Check conflicts'}</button><button type="button" disabled={syncBusy || syncTargets.length === 0 || Boolean(syncResult?.targets.some(item => item.status === 'conflict') && !syncReplace)} onClick={() => void runProviderSync(true)}>{language === 'zh-CN' ? `同步到 ${syncTargets.length} 个 Profile` : `Sync to ${syncTargets.length} Profiles`}</button><button type="button" disabled={syncBusy} onClick={() => setSyncEndpoint(null)}>{t('ui.cancel')}</button></div>
      </div></div>}
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
