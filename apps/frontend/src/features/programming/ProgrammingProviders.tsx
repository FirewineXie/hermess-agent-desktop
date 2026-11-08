import React from 'react'
import type { CodingCatalog, CodingProvider, CodingProviderDraft, CodingProviderResult, CodingValidationStage, ModelProvider } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { type Language } from '../../i18n'
import ProgrammingProviderEditor from './ProgrammingProviderEditor'
import ProgrammingProviderCard from './ProgrammingProviderCard'
import ProgrammingProfileSyncDialog from './ProgrammingProfileSyncDialog'

export default function ProgrammingProviders({ language, profiles, connected, providers, onDirtyChange, onBusyChange, onCatalogChange }: {
  language: Language; profiles: { name: string; display_name?: string }[]; connected: boolean; providers: ModelProvider[]; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void
  onCatalogChange: (catalog: CodingCatalog) => void
}) {
  const { coding } = useDesktop()
  const zh = language === 'zh-CN'
  const [catalog, setCatalog] = React.useState<CodingCatalog | null>(null)
  const [editor, setEditor] = React.useState<CodingProviderDraft | null>(null)
  const [editorMode, setEditorMode] = React.useState<'configuration' | 'models'>('configuration')
  const [syncing, setSyncing] = React.useState(false)
  const [profile, setProfile] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const pending = React.useRef(false)
  React.useEffect(() => { let active = true; coding.catalog().then(value => { if (active) setCatalog(value) }).catch(cause => { if (active) setError(describeError(cause, language)) }); return () => { active = false } }, [coding, language])
  React.useEffect(() => { onDirtyChange(Boolean(editor || syncing)); return () => onDirtyChange(false) }, [editor, syncing, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  const validationMessage = (stage: CodingValidationStage) => {
    const messages = {
      authentication: zh ? '认证失败，请检查 API Key 和访问权限。' : 'Authentication failed. Check the API key and permissions.',
      endpoint: zh ? '连接未接受 Responses 请求，请检查地址、模型和端点支持。' : 'Responses request rejected. Check endpoint and model.',
      stream: zh ? '未收到有效的 Responses 流式结果。' : 'No valid Responses event stream was received.',
      tool_call: zh ? '模型未完成要求的工具调用，不能保存为编程模型。' : 'The model did not produce the required tool call.',
      tool_result: zh ? '工具结果回传未通过校验，原配置保持不变。' : 'Tool-result round trip failed. Existing settings were preserved.',
      connection: zh ? '无法连接，请检查网络和代理地址。' : 'Cannot connect. Check network and base URL.',
      timeout: zh ? '验证超时，原配置保持不变，可稍后重试。' : 'Validation timed out. Existing settings were preserved.',
      profile: zh ? '无法同步此 Profile。请确认 Hermes 已启动，且所选提供商使用可读取的静态 API Key；OAuth、临时凭据及额外认证头不支持复制。' : 'Cannot import this Profile. Hermes must be running and the selected provider must use a static API key; OAuth, temporary credentials and extra auth headers are not copied.',
    }
    return messages[stage]
  }
  const execute = async (action: () => Promise<CodingProviderResult>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await action()
      if (result.error) { setError(validationMessage(result.error)); return }
      if (!result.catalog) throw new Error('Missing programming catalog')
      setCatalog(result.catalog); onCatalogChange(result.catalog); setEditor(null); setSyncing(false); setNotice(zh ? '配置已保存。' : 'Settings saved.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { pending.current = false; setBusy(false) }
  }
  const open = (provider?: CodingProvider, mode: 'configuration' | 'models' = 'configuration') => {
    setEditorMode(mode)
    setError(''); setNotice(''); setSyncing(false)
    setEditor(provider ? { id: provider.id, name: provider.name, region: provider.region, base_url: provider.base_url, models: provider.models.map(model => model.name) } : { name: '', region: 'custom', base_url: '', models: [] })
  }
  const close = () => { if (!busy) { setEditor(null); setSyncing(false); setError('') } }
  return <section className="programming-settings-section">
    <div className="programming-section-title"><div><h2>{zh ? '编程模型提供商' : 'Programming providers and models'}</h2><p>{zh ? '所有 Profile 共用，验证通过后加密保存。' : 'Shared across Profiles. Validated and encrypted locally.'}</p></div><span className="programming-protocol-badge">Responses API</span></div>
    <div className="programming-provider-actions"><button type="button" disabled={busy || !connected || !profiles.length} onClick={() => { setEditor(null); setSyncing(true); setProfile(profiles[0]?.name || ''); setError('') }}>{zh ? '从 Profile 同步' : 'Import from Profile'}</button><button type="button" className="programming-primary" disabled={busy} onClick={() => open()}>{zh ? '新增提供商' : '+ Add provider'}</button></div>
    {catalog && !catalog.providers.length && !editor && !syncing && <p className="programming-provider-empty">{zh ? '添加一个供应商和模型，即可在编程聊天中选择。' : 'Add a provider and model to select them in programming chats.'}</p>}
    <div className="programming-provider-grid">{catalog?.providers.map(provider => <ProgrammingProviderCard key={provider.id} provider={provider} defaultModel={catalog.default_model} language={language} busy={busy} onModels={() => open(provider, 'models')} onEdit={() => open(provider)} onRemove={() => {
      if (window.confirm(zh ? `删除提供商“${provider.name}”？历史会话保留。` : `Remove ${provider.name}? Chat history is retained.`)) void execute(() => coding.removeProvider(provider.id))
    }} />)}</div>
    {editor && <ProgrammingProviderEditor language={language} providers={providers} draft={editor} mode={editorMode} busy={busy} error={error} onChange={setEditor} onClose={close} onSave={() => void execute(() => coding.saveProvider(editor))} />}
    {syncing && <ProgrammingProfileSyncDialog language={language} profiles={profiles} profile={profile} busy={busy} error={error} onSelect={value => { setProfile(value); setError('') }} onClose={close} onSync={provider => {
      void execute(() => coding.syncProfile(profile, provider))
    }} />}


    {error && !editor && !syncing && <p className="programming-error" role="alert">{error}</p>}{notice && <p className="programming-saved" role="status">{notice}</p>}
    {!catalog && !busy && <button type="button" onClick={() => { void coding.catalog().then(setCatalog).catch(cause => setError(describeError(cause, language))) }}>{zh ? '重新读取' : 'Reload'}</button>}
  </section>
}
