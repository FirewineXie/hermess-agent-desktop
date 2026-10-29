import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage } from '../../i18n'
import PersonalFilesView from '../personal-files/PersonalFilesView'
import ProfileOverview from './ProfileOverview'
import { keepFocusInside } from '../extensions/dialogFocus'
import './ProfilesView.css'

type Props = {
  connected: boolean
  epoch: string | null
  profiles: ProfilesSnapshot | null
  profileBusy: boolean
  onSelectProfile: (name: string) => Promise<unknown>
  onDeleteProfile: (name: string) => Promise<{ settlement_pending: boolean; refreshed: boolean }>
  onRenameProfile: (name: string, displayName: string) => Promise<{ display_name: string; refreshed: boolean }>
  memoryOpen: boolean
  onMemoryDirtyChange: (dirty: boolean) => void
  onCloseMemory: () => void
  onOpenExtensions: () => void
  onOpenMemory: () => void
  onOpenConfiguration: (page: 'advanced-runtime' | 'advanced-tools') => void
  onOpenChannels: () => void
  onOpenUsage: () => void
  onNewChat: () => void
}

export default function ProfilesView(props: Props) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [query, setQuery] = React.useState('')
  const [selectionError, setSelectionError] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = React.useState('')
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState('')
  const [deleteNotice, setDeleteNotice] = React.useState('')
  const [renameTarget, setRenameTarget] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [renameBusy, setRenameBusy] = React.useState(false)
  const [renameError, setRenameError] = React.useState('')
  const [renameNotice, setRenameNotice] = React.useState('')
  const servedProfiles = new Set(props.profiles?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]) || [])
  const matchingProfiles = (props.profiles?.profiles || []).filter(profile =>
    `${profile.display_name || ''} ${profile.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  const selectProfile = async (name: string) => {
    if (name === props.profiles?.selected) return
    setSelectionError('')
    try {
      await props.onSelectProfile(name)
    } catch {
      setSelectionError(zh ? '切换专家失败，请重试。' : 'Could not switch experts. Try again.')
    }
  }

  const removeProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!deleteTarget || deleteConfirm !== deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const result = await props.onDeleteProfile(deleteTarget)
      setDeleteNotice(result.settlement_pending
        ? (zh ? 'Profile 目录已删除，但会话或路由身份清理尚未完成。请勿立即复用该内部标识。' : 'Profile directory removed; session or routing identity cleanup is still pending. Do not reuse this ID yet.')
        : result.refreshed
          ? (zh ? '专家已删除。' : 'Expert deleted.')
          : (zh ? '专家已删除，但列表刷新失败，请手动刷新。' : 'Expert deleted, but the list could not refresh. Refresh it manually.'))
      setDeleteTarget(null)
      setDeleteConfirm('')
    } catch {
      setDeleteError(zh ? '删除失败或结果未确认。请刷新专家列表，核对后再尝试。' : 'Deletion failed or its result is uncertain. Refresh the list before retrying.')
    } finally {
      setDeleteBusy(false)
    }
  }

  const renameProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!renameTarget || !renameDraft.trim() || renameBusy) return
    setRenameBusy(true)
    setRenameError('')
    try {
      const result = await props.onRenameProfile(renameTarget, renameDraft)
      setRenameNotice(result.refreshed
        ? (zh ? '显示名称已更新。' : 'Display name updated.')
        : (zh ? '显示名称已保存，但列表刷新失败，请手动刷新。' : 'Display name saved, but the list could not refresh. Refresh it manually.'))
      setRenameTarget(null)
    } catch {
      setRenameError(zh ? '重命名失败，请重试。' : 'Could not rename this expert. Try again.')
    } finally {
      setRenameBusy(false)
    }
  }

  return <section className="settings-panel flat-settings-panel profile-management">
    <aside className="profile-directory" aria-label={zh ? '专家列表' : 'Expert list'}>
      <div className="profile-directory-heading">
        <h2>{zh ? '专家管理' : 'Manage experts'}</h2>
        <p>{zh ? '选择专家，查看配置与数据' : 'Choose an expert to view settings and data'}</p>
      </div>
      <label className="profile-directory-search">
        <span className="sr-only">{zh ? '搜索专家' : 'Search experts'}</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '搜索专家' : 'Search experts'} />
      </label>
      <div className="profile-directory-count">{zh ? '已创建的专家' : 'Created experts'}{props.profiles ? ` · ${props.profiles.profiles.length}` : ''}</div>
      {selectionError && <p className="profile-directory-error" role="alert">{selectionError}</p>}
      {deleteNotice && <p className="profile-directory-notice" role="status">{deleteNotice}</p>}
      {renameNotice && <p className="profile-directory-notice" role="status">{renameNotice}</p>}
      <div className="profile-directory-list">
        {matchingProfiles.map(profile => {
          const name = profile.display_name || profile.name
          const served = props.connected && servedProfiles.has(profile.name)
          const selected = props.profiles?.selected === profile.name
          return <button key={profile.name} type="button" className={`profile-directory-item ${selected ? 'is-selected' : ''}`}
            aria-current={selected ? 'page' : undefined} disabled={!served || props.profileBusy}
            title={!served ? (zh ? `${name}：等待 Gateway 启用` : `${name}: waiting for Gateway`) : name}
            onClick={() => void selectProfile(profile.name)}>
            <span className="profile-directory-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
            <span className="profile-directory-item-text"><strong>{name}</strong><small>{profile.display_name && profile.display_name !== profile.name ? `${profile.name} · ` : ''}{served ? (zh ? 'Gateway 已服务' : 'Served by Gateway') : (zh ? '待启用' : 'Not served')}</small></span>
            {selected && <span className="profile-directory-selected-mark" aria-hidden="true">›</span>}
          </button>
        })}
        {!props.profiles && <p className="profile-directory-empty">{props.connected ? (zh ? '正在读取专家…' : 'Loading experts…') : (zh ? '连接 Gateway 后显示专家。' : 'Connect to Gateway to view experts.')}</p>}
        {props.profiles && matchingProfiles.length === 0 && <p className="profile-directory-empty">{zh ? '没有匹配的专家。' : 'No matching experts.'}</p>}
      </div>
      <button type="button" className="profile-directory-create" onClick={props.onOpenExtensions}>{zh ? '前往「扩展中心」' : 'Open Extension Hub'} <span aria-hidden="true">›</span></button>
    </aside>
    <div className="profile-detail-scroll">{props.memoryOpen ? <PersonalFilesView
      connected={props.connected} profile={props.profiles?.selected || null} epoch={props.epoch}
      initialTab="memory" onDirtyChange={props.onMemoryDirtyChange} onClose={props.onCloseMemory} /> : <ProfileOverview
      connected={props.connected}
      epoch={props.epoch}
      profiles={props.profiles}
      profileBusy={props.profileBusy}
      onDeleteProfile={() => {
        const name = props.profiles?.selected
        if (!name || name === 'default') return
        setDeleteTarget(name)
        setDeleteConfirm('')
        setDeleteError('')
      }}
      onRenameProfile={() => {
        const profile = props.profiles?.profiles.find(item => item.name === props.profiles?.selected)
        if (!profile) return
        setRenameTarget(profile.name)
        setRenameDraft(profile.display_name || profile.name)
        setRenameError('')
      }}
      onNewChat={props.onNewChat}
      onOpenMemory={props.onOpenMemory}
      onOpenConfiguration={props.onOpenConfiguration}
      onOpenChannels={props.onOpenChannels}
      onOpenUsage={props.onOpenUsage}
      onOpenExtensions={props.onOpenExtensions}
    />}</div>
    {deleteTarget && <div className="profile-delete-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deleteBusy) setDeleteTarget(null) }}>
      <form className="profile-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-delete-title" onSubmit={event => void removeProfile(event)} onKeyDown={event => { if (event.key === 'Escape' && !deleteBusy) setDeleteTarget(null); else keepFocusInside(event) }}>
        <h2 id="profile-delete-title">{zh ? '删除专家' : 'Delete expert'}</h2>
        <p>{zh ? '将删除此 Profile 的配置、会话和本地资料。此操作无法撤销。' : 'This removes the Profile configuration, sessions and local data. This cannot be undone.'}</p>
        <p><strong>{deleteTarget}</strong></p>
        <label>{zh ? '输入上方的内部标识以确认' : 'Type the internal ID to confirm'}<input autoFocus value={deleteConfirm} onChange={event => setDeleteConfirm(event.target.value)} disabled={deleteBusy} /></label>
        {deleteError && <p role="alert">{deleteError}</p>}
        <div className="profile-delete-actions"><button type="button" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={deleteBusy || deleteConfirm !== deleteTarget}>{deleteBusy ? (zh ? '正在删除…' : 'Deleting…') : (zh ? '确认删除' : 'Delete')}</button></div>
      </form>
    </div>}
    {renameTarget && <div className="profile-delete-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !renameBusy) setRenameTarget(null) }}>
      <form className="profile-delete-dialog profile-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-rename-title" onSubmit={event => void renameProfile(event)} onKeyDown={event => { if (event.key === 'Escape' && !renameBusy) setRenameTarget(null); else keepFocusInside(event) }}>
        <h2 id="profile-rename-title">{zh ? '重命名专家' : 'Rename expert'}</h2>
        <p>{zh ? '这里只修改界面显示名称，可以使用中文；内部标识和数据目录保持不变。' : 'This changes the display name only. The internal ID and data directory stay the same.'}</p>
        <p>{zh ? '内部标识：' : 'Internal ID: '}<strong>{renameTarget}</strong></p>
        <label>{zh ? '显示名称' : 'Display name'}<input autoFocus maxLength={64} value={renameDraft} onChange={event => setRenameDraft(event.target.value)} disabled={renameBusy} /></label>
        {renameError && <p role="alert">{renameError}</p>}
        <div className="profile-delete-actions"><button type="button" disabled={renameBusy} onClick={() => setRenameTarget(null)}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={renameBusy || !renameDraft.trim()}>{renameBusy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存名称' : 'Save name')}</button></div>
      </form>
    </div>}
  </section>
}
