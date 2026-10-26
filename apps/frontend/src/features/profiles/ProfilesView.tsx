import React from 'react'
import type { PersonalitiesSnapshot, ProfilesSnapshot, ProfilePresetSelection, SessionRow } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { clientProfilePresets, type ClientProfilePreset } from './presets'
import ProfileOverview from './ProfileOverview'

type Props = {
  connected: boolean
  profiles: ProfilesSnapshot | null
  sessions: SessionRow[]
  sessionsState: 'loading' | 'ready' | 'error'
  profileBusy: boolean
  profileError: string
  profilePendingRestart: boolean
  onSelect: (name: string) => Promise<void>
  onCreate: (name: string, preset: ProfilePresetSelection) => Promise<void>
  onRetry: () => Promise<void>
  onOpenExtensions: () => void
  onOpenMemory: () => void
  onOpenData: () => void
  onNewChat: () => void
}

export default function ProfilesView({ connected, profiles, sessions, sessionsState, profileBusy, profileError, profilePendingRestart, onSelect, onCreate, onRetry, onOpenExtensions, onOpenMemory, onOpenData, onNewChat }: Props) {
  const { profiles: api } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [personalities, setPersonalities] = React.useState<PersonalitiesSnapshot | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [chosen, setChosen] = React.useState<ClientProfilePreset | null>(null)
  const [name, setName] = React.useState('')
  const [skills, setSkills] = React.useState<string[]>([])
  const [mcp, setMcp] = React.useState<string[]>([])
  const selectedProfile = profiles?.selected || 'default'
  const selectedProfileRef = React.useRef(selectedProfile)
  selectedProfileRef.current = selectedProfile

  React.useEffect(() => {
    if (!connected) { setPersonalities(null); return }
    let cancelled = false
    setLoading(true)
    setError('')
    void api.listPersonalities().then(value => {
      if (!cancelled && value.profile === selectedProfileRef.current) setPersonalities(value)
    }).catch(cause => {
      if (!cancelled) setError(describeError(cause, language))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, connected, selectedProfile, language])

  async function apply(name: string, prompt?: string) {
    if (saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const next = await api.applyPersonality(name, prompt)
      if (next.profile === selectedProfileRef.current) {
        setPersonalities(next)
        setNotice(zh ? '已保存到当前 Profile；新会话会使用此性格。' : 'Saved to this profile; new sessions use this personality.')
      }
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setSaving(false) }
  }

  function choose(preset: ClientProfilePreset) {
    setChosen(preset)
    setName(preset.id)
    setSkills(preset.skills)
    setMcp(preset.mcp)
    setError(''); setNotice('')
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!chosen || !name.trim() || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      await onCreate(name.trim(), {
        personalityName: chosen.personality.name,
        personalityPrompt: chosen.personality.prompt,
        skills,
        mcp,
      })
      setChosen(null)
      setNotice(zh ? 'Profile 已创建；请核对启用状态、模型和扩展。' : 'Profile created; check service, model, and extensions.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setSaving(false) }
  }

  if (!connected) return <section className="settings-panel flat-settings-panel profile-management"><ProfileOverview connected={connected} profiles={profiles} sessions={sessions} sessionsState={sessionsState} onNewChat={onNewChat} onOpenSkills={onOpenExtensions} onOpenMemory={onOpenMemory} onOpenData={onOpenData} /><p>{zh ? '启动运行时后可查看性格和创建角色。' : 'Start the runtime to view personalities and create roles.'}</p></section>

  const runtimeEntries = personalities?.entries || []
  return <section className="settings-panel flat-settings-panel profile-management">
    <ProfileOverview connected={connected} profiles={profiles} sessions={sessions} sessionsState={sessionsState} onNewChat={onNewChat} onOpenSkills={onOpenExtensions} onOpenMemory={onOpenMemory} onOpenData={onOpenData} />
    <details className="profile-legacy-settings"><summary>{zh ? '角色、性格与 Profile 设置' : 'Roles, personalities and profile settings'}</summary>
    <div className="row"><h2>{zh ? '角色与 Profile' : 'Roles and profiles'}</h2></div>
    <p>{zh ? '性格改变回答风格；角色模板可在独立 Profile 中启用指定 Skill。每个 Profile 的会话和配置分开保存。' : 'Personalities change response style. Role templates can enable selected skills in a separate profile.'}</p>
    {profilePendingRestart && <p role="status">{zh ? '新 Profile 已创建，等待 Gateway 空闲后启用。' : 'Profile created; enable it when the Gateway is idle.'} <button type="button" disabled={profileBusy} onClick={() => void onRetry()}>{zh ? '重试启用' : 'Retry'}</button></p>}
    <h3>{zh ? '我的 Profile' : 'My profiles'}</h3>
    <div className="profile-card-list">{profiles?.profiles.map(profile => <article className="profile-card" key={profile.name}>
      <strong>{profile.display_name || profile.name}</strong>
      <span>{profile.name === selectedProfile ? (zh ? '当前使用' : 'Selected') : (profile.model || profile.provider || '')}</span>
      {profile.name !== selectedProfile && <button disabled={profileBusy || saving} onClick={() => void onSelect(profile.name).catch(cause => setError(describeError(cause, language)))}>{zh ? '切换' : 'Select'}</button>}
    </article>)}</div>
    <h3>{zh ? 'Hermess 角色预设' : 'Hermess role presets'}</h3>
    <p>{zh ? '预设由客户端提供。创建时只启用勾选的随包 Skill；必要的核心 Skill 仍由 Hermes 保留。' : 'These presets come from the client. Only checked bundled skills are enabled, apart from Hermes essentials.'}</p>
    <div className="profile-preset-grid">{clientProfilePresets.map(preset => <article className="profile-preset-card" key={preset.id}>
      <div className="row"><strong>{preset.title[language]}</strong><small>{zh ? 'Hermess 内置' : 'Hermess built-in'}</small></div>
      <p>{preset.description[language]}</p>
      <small>{zh ? '性格' : 'Personality'}: {preset.personality.name}</small>
      <small>Skill: {preset.skills.length ? preset.skills.join('、') : (zh ? '无额外 Skill' : 'No extra skills')}</small>
      <small>MCP: {preset.mcp.length ? preset.mcp.join('、') : (zh ? '无' : 'None')}</small>
      <div className="profile-actions"><button disabled={saving || profileBusy || personalities?.active === preset.personality.name} onClick={() => void apply(preset.personality.name, preset.personality.prompt)}>{personalities?.active === preset.personality.name ? (zh ? '性格使用中' : 'Personality active') : (zh ? '仅应用性格' : 'Apply personality only')}</button><button disabled={saving || profileBusy} onClick={() => choose(preset)}>{zh ? '创建独立 Profile' : 'Create profile'}</button></div>
    </article>)}</div>
    {chosen && <form className="profile-create-form" onSubmit={event => void create(event)}>
      <div className="row"><h3>{zh ? `创建：${chosen.title[language]}` : `Create: ${chosen.title[language]}`}</h3><button type="button" onClick={() => setChosen(null)}>{zh ? '取消' : 'Cancel'}</button></div>
      <label>{zh ? 'Profile 名称' : 'Profile name'}<input required maxLength={64} value={name} onChange={event => setName(event.target.value)} /></label>
      {chosen.skills.length > 0 && <fieldset><legend>{zh ? '启用随包 Skill' : 'Enable bundled skills'}</legend>{chosen.skills.map(skill => <label key={skill}><input type="checkbox" checked={skills.includes(skill)} onChange={event => setSkills(previous => event.target.checked ? [...previous, skill] : previous.filter(item => item !== skill))} />{skill}</label>)}</fieldset>}
      {chosen.mcp.length > 0 && <><fieldset><legend>{zh ? '配置精选 MCP（新会话中加载）' : 'Configure curated MCP servers (loads in new sessions)'}</legend>{chosen.mcp.map(server => <label key={server}><input type="checkbox" checked={mcp.includes(server)} onChange={event => setMcp(previous => event.target.checked ? [...previous, server] : previous.filter(item => item !== server))} />{server}</label>)}</fieldset><p>{zh ? '这里只写入配置；创建后请在“扩展”页测试连接。' : 'This writes configuration only; test the connection in Extensions after creation.'} <button type="button" onClick={onOpenExtensions}>{zh ? '打开扩展' : 'Open extensions'}</button></p></>}
      <button disabled={saving || profileBusy || !name.trim()} type="submit">{zh ? '创建 Profile' : 'Create profile'}</button>
    </form>}
    <h3>{zh ? 'Hermes 性格' : 'Hermes personalities'}</h3>
    <p>{zh ? '这些性格来自当前运行时，不附带 Skill 或 MCP。当前 Profile 的自定义性格也列在这里。' : 'These personalities come from the runtime and include no skills or MCP servers. This profile’s custom entries appear here too.'}</p>
    {loading && <p>{zh ? '读取中…' : 'Loading…'}</p>}
    <div className="profile-card-list">{runtimeEntries.map(entry => <article className="profile-card" key={entry.name}>
      <div><strong>{entry.name}</strong><small>{entry.source === 'custom' ? (zh ? '当前 Profile 自定义' : 'Profile custom') : (zh ? 'Hermes 内置' : 'Hermes built-in')}</small><p>{entry.description}</p></div>
      <button disabled={saving || profileBusy || personalities?.active === entry.name} onClick={() => void apply(entry.name)}>{personalities?.active === entry.name ? (zh ? '使用中' : 'Active') : (zh ? '使用' : 'Use')}</button>
    </article>)}</div>
    {personalities?.active !== 'none' && <button disabled={saving || profileBusy} onClick={() => void apply('none')}>{zh ? '清除当前性格' : 'Clear personality'}</button>}
    {notice && <p role="status">{notice}</p>}
    {(error || profileError) && <p role="alert">{error || profileError}</p>}
    </details>
  </section>
}
