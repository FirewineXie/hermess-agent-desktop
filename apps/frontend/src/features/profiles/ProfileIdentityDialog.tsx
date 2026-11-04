import React from 'react'
import type { ProfileRow } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { keepFocusInside } from '../extensions/dialogFocus'

type Props = {
  profile: ProfileRow
  language: 'zh-CN' | 'en-US'
  busy: boolean
  onRenameId: (name: string, newName: string) => Promise<{ name: string; selection_persisted: boolean; served: boolean; refreshed: boolean }>
  onSaveDescription: (name: string, description: string) => Promise<{ description: string; description_auto: false }>
  onDescribeAuto: (name: string, overwrite: boolean) => Promise<{ ok: boolean; reason: string | null; description: string | null; description_auto: boolean }>
  onOpenSoul: () => void
  onClose: () => void
}

export default function ProfileIdentityDialog({ profile, language, busy, onRenameId, onSaveDescription, onDescribeAuto, onOpenSoul, onClose }: Props) {
  const profileApi = useDesktop().profiles
  const zh = language === 'zh-CN'
  const [description, setDescription] = React.useState(profile.description || '')
  const [savedDescription, setSavedDescription] = React.useState(profile.description || '')
  const [descriptionAuto, setDescriptionAuto] = React.useState(Boolean(profile.description_auto))
  const [newId, setNewId] = React.useState(profile.name)
  const [action, setAction] = React.useState<'description' | 'auto' | 'rename' | 'setup-command' | null>(null)
  const [loadingIdentity, setLoadingIdentity] = React.useState(true)
  const [identityLoaded, setIdentityLoaded] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState('')
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    descriptionRef.current?.focus()
    return () => { document.body.style.overflow = previous }
  }, [])

  const loadIdentity = React.useCallback(async () => {
    setLoadingIdentity(true); setError('')
    try {
      const identity = await profileApi.identity(profile.name)
      setDescription(identity.description)
      setSavedDescription(identity.description)
      setDescriptionAuto(identity.description_auto)
      setIdentityLoaded(true)
    } catch (cause) {
      setIdentityLoaded(false)
      setError(describeError(cause, language))
    } finally { setLoadingIdentity(false) }
  }, [profile.name, profileApi, language])
  React.useEffect(() => { void loadIdentity() }, [loadIdentity])

  const working = busy || action !== null || loadingIdentity
  const descriptionDirty = description !== savedDescription
  const normalizedId = newId.trim().toLowerCase()
  const idValid = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedId)

  function close(): boolean {
    if (working) return false
    if (descriptionDirty && !window.confirm(zh ? '职责说明有未保存修改，确定放弃吗？' : 'Discard unsaved role description changes?')) return false
    onClose()
    return true
  }

  async function saveDescription() {
    if (working || !identityLoaded) return
    setAction('description'); setError(''); setMessage('')
    try {
      const result = await onSaveDescription(profile.name, description)
      setDescription(result.description)
      setSavedDescription(result.description)
      setDescriptionAuto(false)
      setMessage(zh ? '职责说明已保存。看板分派会使用这项说明。' : 'Role description saved. Kanban assignment uses this description.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setAction(null) }
  }

  async function generateDescription() {
    if (working || !identityLoaded) return
    const overwrite = Boolean(description.trim())
    if (overwrite && !window.confirm(zh ? '自动生成会覆盖当前职责说明，继续吗？' : 'Automatic generation replaces the current description. Continue?')) return
    setAction('auto'); setError(''); setMessage('')
    try {
      const result = await onDescribeAuto(profile.name, overwrite)
      if (!result.ok) {
        setError(result.reason || (zh ? '自动生成没有完成。' : 'Automatic description did not complete.'))
        return
      }
      setDescription(result.description || '')
      setSavedDescription(result.description || '')
      setDescriptionAuto(result.description_auto)
      setMessage(zh ? '已生成职责说明。' : 'Role description generated.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setAction(null) }
  }

  async function renameId() {
    if (working || !identityLoaded || profile.name === 'default' || !idValid || normalizedId === profile.name) return
    if (!window.confirm(zh
      ? `内部标识将从 ${profile.name} 改为 ${normalizedId}，Profile 目录、路由身份和包装脚本会同步更新。继续吗？`
      : `The internal ID changes from ${profile.name} to ${normalizedId}. The profile directory, routing identity and wrapper scripts will be updated. Continue?`)) return
    setAction('rename'); setError(''); setMessage('')
    try {
      const result = await onRenameId(profile.name, normalizedId)
      if (!result.refreshed) {
        onClose()
        return
      }
      if (!result.served) {
        setMessage(zh ? '标识已更新，但 Gateway 尚未服务新标识；请使用侧栏的重试入口。' : 'ID updated, but the Gateway is not serving the new ID yet. Use Retry in the sidebar.')
        return
      }
      onClose()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setAction(null) }
  }

  async function copySetupCommand() {
    if (working || !identityLoaded) return
    setAction('setup-command'); setError(''); setMessage('')
    try {
      const result = await profileApi.setupCommand(profile.name)
      await navigator.clipboard.writeText(result.command)
      setMessage(zh ? 'Profile 启动命令已复制；桌面端不会自动启动额外进程。' : 'Profile launch command copied. The desktop app did not start another process.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setAction(null) }
  }

  return <div className="profile-delete-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section className="profile-delete-dialog profile-identity-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-identity-title"
      onKeyDown={event => { if (event.key === 'Escape') close(); else keepFocusInside(event) }}>
      <header><div><h2 id="profile-identity-title">{zh ? '身份与职责' : 'Identity and role'}</h2><p>{zh ? '管理看板分派依据、内部标识和 SOUL.md。' : 'Manage Kanban routing context, the internal ID and SOUL.md.'}</p></div><button type="button" aria-label={zh ? '关闭' : 'Close'} disabled={working} onClick={close}>×</button></header>
      <div className="profile-identity-dialog-body">
        <section><div className="profile-identity-section-heading"><div><h3>{zh ? '职责说明' : 'Role description'}</h3><small>{descriptionAuto ? (zh ? '当前由模型生成' : 'Currently model-generated') : (zh ? '当前由用户维护' : 'Currently user-maintained')}</small></div></div>
          <textarea ref={descriptionRef} rows={5} disabled={working || !identityLoaded} value={description} onChange={event => setDescription(event.target.value)} placeholder={zh ? '说明这个 Profile 擅长什么、适合接收哪些任务。' : 'Describe what this profile is good at and which tasks it should receive.'} />
          <div className="profile-identity-actions"><button type="button" disabled={working || !identityLoaded} onClick={() => void saveDescription()}>{action === 'description' ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存职责' : 'Save role')}</button><button type="button" disabled={working || !identityLoaded} onClick={() => void generateDescription()}>{action === 'auto' ? (zh ? '生成中…' : 'Generating…') : (zh ? '自动生成' : 'Generate automatically')}</button></div>
        </section>
        <section><h3>SOUL.md</h3><p>{zh ? '定义当前 Profile 的人格和长期行为。保存后新会话读取更新。' : 'Defines this profile’s persona and lasting behavior. New sessions load the update.'}</p><button type="button" disabled={working} onClick={() => { if (close()) onOpenSoul() }}>{zh ? '编辑 SOUL.md' : 'Edit SOUL.md'}</button></section>
        <section><h3>{zh ? '终端命令' : 'Terminal command'}</h3><p>{zh ? '复制锁定 Hermes 生成的当前 Profile 命令，供你在外部终端手动使用；此操作不会创建进程。' : 'Copy the command generated by the locked Hermes build for manual use in an external terminal. This does not create a process.'}</p><button type="button" disabled={working || !identityLoaded} onClick={() => void copySetupCommand()}>{action === 'setup-command' ? (zh ? '读取中…' : 'Loading…') : (zh ? '复制 Profile 命令' : 'Copy profile command')}</button></section>
        <section><h3>{zh ? '内部标识' : 'Internal ID'}</h3>{profile.name === 'default'
          ? <p>{zh ? 'default 是固定根标识，不能改名；可修改显示名称。' : 'default is the fixed root ID and cannot be renamed. Its display name can be changed.'}</p>
          : <><p>{zh ? '改名会更新目录、Gateway 路由身份和命令包装脚本。' : 'Renaming updates the directory, Gateway routing identity and command wrapper scripts.'}</p><label>{zh ? '新内部标识' : 'New internal ID'}<input spellCheck={false} autoComplete="off" disabled={working || !identityLoaded} value={newId} onChange={event => setNewId(event.target.value)} /></label><button type="button" className="profile-identity-rename" title={descriptionDirty ? (zh ? '请先保存或放弃职责说明修改' : 'Save or discard role changes first') : undefined} disabled={working || !identityLoaded || descriptionDirty || !idValid || normalizedId === profile.name} onClick={() => void renameId()}>{action === 'rename' ? (zh ? '重命名中…' : 'Renaming…') : (zh ? '重命名内部标识' : 'Rename internal ID')}</button></>}
        </section>
        {message && <p role="status" className="profile-directory-notice">{message}</p>}
        {error && <div className="profile-identity-load-error"><p role="alert" className="profile-directory-error">{error}</p>{!identityLoaded && !loadingIdentity && <button type="button" onClick={() => void loadIdentity()}>{zh ? '重试读取' : 'Retry'}</button>}</div>}
      </div>
      <footer><button type="button" disabled={working} onClick={close}>{zh ? '关闭' : 'Close'}</button></footer>
    </section>
  </div>
}
