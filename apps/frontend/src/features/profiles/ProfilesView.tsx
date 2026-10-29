import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage } from '../../i18n'
import PersonalFilesView from '../personal-files/PersonalFilesView'
import ProfileOverview from './ProfileOverview'
import './ProfilesView.css'

type Props = {
  connected: boolean
  epoch: string | null
  profiles: ProfilesSnapshot | null
  profileBusy: boolean
  onSelectProfile: (name: string) => Promise<unknown>
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
            <span className="profile-directory-item-text"><strong>{name}</strong><small>{served ? (zh ? 'Gateway 已服务' : 'Served by Gateway') : (zh ? '待启用' : 'Not served')}</small></span>
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
      onNewChat={props.onNewChat}
      onOpenMemory={props.onOpenMemory}
      onOpenConfiguration={props.onOpenConfiguration}
      onOpenChannels={props.onOpenChannels}
      onOpenUsage={props.onOpenUsage}
    />}</div>
  </section>
}
