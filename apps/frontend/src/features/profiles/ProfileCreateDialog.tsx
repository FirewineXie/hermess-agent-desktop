import React from 'react'
import type { ProfileCreateOptions, ProfilesSnapshot } from '@hermess/contracts'
import { describeError } from '../../app/desktopErrors'
import { keepFocusInside } from '../extensions/dialogFocus'
import ProfileCreateAdvancedOptions from './ProfileCreateAdvancedOptions'

type CreateResult = { name: string; warnings?: string[]; served: boolean } | undefined

type Props = {
  language: 'zh-CN' | 'en-US'
  profiles: ProfilesSnapshot | null
  busy: boolean
  onCreate: (name: string, options?: ProfileCreateOptions) => Promise<CreateResult>
  onClose: () => void
  onCreated: (message: string) => void
}

export default function ProfileCreateDialog({ language, profiles, busy, onCreate, onClose, onCreated }: Props) {
  const zh = language === 'zh-CN'
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [cloneFrom, setCloneFrom] = React.useState('')
  const [cloneAll, setCloneAll] = React.useState(false)
  const [advanced, setAdvanced] = React.useState<ProfileCreateOptions>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')

  const close = () => { if (!submitting) onClose() }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting || busy) return
    const normalized = name.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
      setError(zh ? '内部标识须以字母或数字开头，仅含小写字母、数字、-、_，最多 64 个字符。' : 'Use up to 64 lowercase letters, numbers, hyphens or underscores, starting with a letter or number.')
      return
    }
    if (profiles?.profiles.some(profile => profile.name.toLowerCase() === normalized)) {
      setError(zh ? '这个 Profile 已存在，请更换内部标识。' : 'This profile already exists. Choose another internal ID.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const options: ProfileCreateOptions = {
        ...advanced,
        cloneFrom: cloneFrom || null,
        cloneAll: Boolean(cloneFrom) && cloneAll,
        description: description.trim() || undefined,
      }
      const result = await onCreate(normalized, options)
      if (!result) return
      onCreated(result.served
        ? (zh ? `Profile“${normalized}”已创建并启用。` : `Profile “${normalized}” was created and enabled.`)
        : (zh ? `Profile“${normalized}”已创建，等待 Gateway 启用。` : `Profile “${normalized}” was created and is waiting for the Gateway.`))
      onClose()
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="profile-delete-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <form className="profile-delete-dialog profile-create-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-create-title" onSubmit={event => void submit(event)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } else keepFocusInside(event) }}>
      <h2 id="profile-create-title">{zh ? '新建 Profile' : 'Create profile'}</h2>
      <p>{zh ? '在本机创建独立 Profile。模型与提供商在创建后到“设置”中配置。' : 'Create an independent local profile. Configure its model and provider in Settings afterward.'}</p>
      <label>{zh ? '内部标识' : 'Internal ID'}<input autoFocus required maxLength={64} spellCheck={false} autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder="research-agent" /></label>
      <small>{zh ? '用于命令、目录和任务分派；创建后不随显示名称改变。' : 'Used by commands, folders and task assignment; it does not change with the display name.'}</small>
      <label>{zh ? '职责说明（可选）' : 'Role description (optional)'}<textarea maxLength={1024} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder={zh ? '例如：负责检索资料、核对来源并输出研究结论。' : 'For example: Research sources, verify evidence and summarize findings.'} /></label>
      <label>{zh ? '创建方式' : 'Creation method'}<select value={cloneFrom} onChange={event => { const source = event.target.value; setCloneFrom(source); if (!source) setCloneAll(false); if (source && advanced.noSkills) setAdvanced(current => ({ ...current, noSkills: false })) }}>
        <option value="">{zh ? '全新 Profile' : 'Fresh profile'}</option>
        {(profiles?.profiles || []).map(profile => <option key={profile.name} value={profile.name}>{zh ? `克隆 ${profile.display_name || profile.name}` : `Clone ${profile.display_name || profile.name}`}</option>)}
      </select></label>
      {cloneFrom && <label className="profile-create-check"><input type="checkbox" checked={cloneAll} onChange={event => setCloneAll(event.target.checked)} /><span><strong>{zh ? '全量克隆' : 'Clone all state'}</strong><small>{zh ? '同时复制记忆、会话和运行状态；消息渠道凭据仍会安全移除。未勾选时只复制配置、人格和技能。' : 'Also copy memories, sessions and runtime state. Messaging credentials are still stripped. Otherwise only configuration, persona and skills are copied.'}</small></span></label>}
      <ProfileCreateAdvancedOptions language={language} sourceProfile={profiles?.selected || null} cloning={Boolean(cloneFrom)} disabled={submitting || busy} value={advanced} onChange={setAdvanced} />
      {error && <p className="profile-directory-error" role="alert">{error}</p>}
      <div className="profile-delete-actions"><button type="button" disabled={submitting} onClick={close}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={submitting || busy || !name.trim()}>{submitting ? (zh ? '正在创建…' : 'Creating…') : (zh ? '创建 Profile' : 'Create profile')}</button></div>
    </form>
  </div>
}
