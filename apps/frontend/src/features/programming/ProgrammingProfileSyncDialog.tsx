import React from 'react'
import type { CodingProfileProvider } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { keepFocusInside } from '../extensions/dialogFocus'

export default function ProgrammingProfileSyncDialog({ language, profiles, profile, busy, error, onSelect, onClose, onSync }: {
  language: Language; profiles: { name: string; display_name?: string }[]; profile: string; busy: boolean; error: string
  onSelect: (profile: string) => void; onClose: () => void; onSync: (provider: string) => void
}) {
  const zh = language === 'zh-CN'
  const { coding } = useDesktop()
  const [providers, setProviders] = React.useState<CodingProfileProvider[]>([])
  const [providerId, setProviderId] = React.useState('')
  const [loadedProfile, setLoadedProfile] = React.useState('')
  const [loadingError, setLoadingError] = React.useState('')
  const [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    let active = true
    setProviders([]); setProviderId(''); setLoadedProfile(''); setLoadingError('')
    void coding.profileProviders(profile).then(value => {
      if (!active) return
      setProviders(value); setLoadedProfile(profile)
    }).catch(cause => { if (active) setLoadingError(describeError(cause, language)) })
    return () => { active = false }
  }, [coding, profile, language, reload])
  const selected = loadedProfile === profile ? providers.find(provider => provider.id === providerId) : undefined

  const origin = React.useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  React.useEffect(() => () => { origin.current?.isConnected && origin.current.focus() }, [])
  return <div className="provider-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form className="provider-add-form programming-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="programming-sync-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() }
      keepFocusInside(event)
    }} onSubmit={event => { event.preventDefault(); if (selected && !busy) onSync(selected.id) }}>
      <div className="row model-editor-heading"><h3 id="programming-sync-title">{zh ? '从 Profile 同步' : 'Import from Profile'}</h3><button type="button" aria-label={zh ? '关闭' : 'Close'} disabled={busy} onClick={onClose}>×</button></div>
      <label>Profile<select autoFocus required value={profile} disabled={busy} onChange={event => onSelect(event.target.value)}>{profiles.map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label>
      {loadingError ? <p role="alert">{loadingError} <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>{zh ? '重新读取' : 'Retry'}</button></p> : loadedProfile !== profile ? <p role="status">{zh ? '正在读取提供商…' : 'Loading providers…'}</p> : providers.length ? <>
        <label>{zh ? '选择一个模型提供商' : 'Select one model provider'}<select required value={providerId} disabled={busy} onChange={event => setProviderId(event.target.value)}><option value="" disabled>{zh ? '请选择要同步的提供商' : 'Choose a provider to import'}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        {selected && <div className="programming-import-preview"><small>{selected.base_url}</small><strong>{zh ? `将同步 ${selected.models.length} 个模型` : `${selected.models.length} models to import`}</strong><ul>{selected.models.map(model => <li key={model}>{model}</li>)}</ul></div>}
      </> : <p role="status">{zh ? '此 Profile 没有可同步的静态 API Key 提供商与模型。' : 'This Profile has no importable static API-key providers and models.'}</p>}
      <p>{zh ? '每次只同步一个提供商，包含其地址、API Key 和全部上述模型，逐个验证后加密保存。密钥不经过前端；后续修改 Profile 不会覆盖此副本。' : 'Imports one provider at a time, including its URL, API key and all listed models. Each model is validated and the copy is encrypted. The key stays in the backend; later Profile changes do not overwrite the copy.'}</p>
      {error && <p className="programming-error" role="alert">{error}</p>}
      <div className="actions"><button type="submit" disabled={busy || !selected}>{busy ? (zh ? '正在同步并验证…' : 'Importing and validating…') : (zh ? '同步所选提供商' : 'Import selected provider')}</button><button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button></div>
    </form>
  </div>
}
