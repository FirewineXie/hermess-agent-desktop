import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type VaultStatus = { storage: 'file' | 'keychain' | 'none'; preference: 'file' | 'keychain'; available: boolean; cleanup_pending: boolean }

export default function ProfileVaultKeys({ profile }: { profile: string }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [status, setStatus] = React.useState<VaultStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const scope = { kind: 'profile' as const, profile }
  React.useEffect(() => {
    let active = true
    setBusy(true)
    void extensions.request<VaultStatus>({ kind: 'profile', profile }, 'vault.key.status')
      .then(result => { if (active) setStatus(result) })
      .catch(cause => { if (active) setError(describeError(cause, language)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [extensions, profile, language])

  async function migrate(target: 'keychain' | 'file') {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await extensions.request<VaultStatus>(scope, 'vault.key.migrate', { target })
      setStatus(result)
      if (result.storage !== 'none' && result.storage !== target) throw new Error(zh ? 'Vault 未确认迁移。' : 'The vault did not confirm the move.')
      setMessage(result.storage === 'none'
        ? (zh ? '已保存首个 Vault 条目使用的密钥存储位置。' : 'Saved the key storage location for the first vault item.')
        : (zh ? 'Vault 密钥存储位置已更新。' : 'Vault key storage updated.'))
    } catch (cause) {
      setError(describeError(cause, language))
      try { setStatus(await extensions.request<VaultStatus>(scope, 'vault.key.status')) } catch { setStatus(null) }
    } finally { setBusy(false) }
  }

  const storageLabels = zh ? { file: 'Profile 内的密钥文件', keychain: '系统钥匙串', none: '尚未创建密钥' }
    : { file: 'Key file in the Profile', keychain: 'System keychain', none: 'No key created yet' }
  const effective = status?.storage === 'none' ? status.preference : status?.storage
  return <section className="profile-data-panel" aria-label={zh ? 'Hermes Vault 密钥' : 'Hermes Vault key'}>
    <div className="profile-skills-heading"><div><h3>{zh ? 'Hermes Vault 密钥' : 'Hermes Vault key'}</h3>
      <p>{status ? `${zh ? '当前位置' : 'Current location'} · ${storageLabels[status.storage]}` : busy ? (zh ? '读取中…' : 'Loading…') : (zh ? '状态不可用' : 'Status unavailable')}</p>
      {status?.storage === 'none' && <p>{zh ? '新密钥将使用' : 'New keys will use'} · {storageLabels[status.preference]}</p>}
    </div>{status && <button type="button" disabled={busy || !status.available && effective === 'file'} onClick={() => void migrate(effective === 'keychain' ? 'file' : 'keychain')}>
      {effective === 'keychain' ? (zh ? '移回 Profile 密钥文件' : 'Move to a Profile key file') : (zh ? '移至系统钥匙串' : 'Move to the system keychain')}
    </button>}</div>
    {status && !status.available && <p>{zh ? '此运行时当前无法访问系统钥匙串。' : 'This runtime cannot access the system keychain right now.'}</p>}
    {status?.storage === 'keychain' && <p>{zh ? 'Profile 备份只包含加密 Vault。换机前可先将密钥移回 Profile 文件。' : 'A Profile backup contains the encrypted vault. Move the key back to a Profile file before transferring it to another machine.'}</p>}
    {status?.cleanup_pending && <p>{zh ? '系统钥匙串中仍有待清理的副本。' : 'A copy remains in the system keychain.'}</p>}
    {status?.cleanup_pending && <button type="button" disabled={busy || !status.available} onClick={() => void migrate('file')}>{zh ? '重试清理钥匙串副本' : 'Retry removing the keychain copy'}</button>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
