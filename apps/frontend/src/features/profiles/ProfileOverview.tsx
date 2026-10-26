import React from 'react'
import type { PersonalFile, ProfilesSnapshot, SessionRow } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { LocalSkill, McpServer } from '../extensions/model'

type Tab = 'overview' | 'skills' | 'mcp' | 'memory' | 'data'

type Props = {
  connected: boolean
  profiles: ProfilesSnapshot | null
  sessions: SessionRow[]
  sessionsState: 'loading' | 'ready' | 'error'
  onNewChat: () => void
  onOpenSkills: () => void
  onOpenMemory: () => void
  onOpenData: () => void
}

export default function ProfileOverview({ connected, profiles, sessions, sessionsState, onNewChat, onOpenSkills, onOpenMemory, onOpenData }: Props) {
  const { extensions, personalFiles } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [tab, setTab] = React.useState<Tab>('overview')
  const [skills, setSkills] = React.useState<LocalSkill[] | null>(null)
  const [servers, setServers] = React.useState<McpServer[] | null>(null)
  const [memory, setMemory] = React.useState<PersonalFile | null>(null)
  const [errors, setErrors] = React.useState<string[]>([])
  const profile = profiles?.profiles.find(item => item.name === profiles.selected)
  const name = profile?.display_name || profile?.name || (zh ? '当前 Profile' : 'Current profile')
  const served = Boolean(connected && profiles?.gateways.some(gateway => gateway.served_profiles?.includes(profiles.selected) || gateway.profile === profiles.selected))

  React.useEffect(() => {
    if (!connected || !profiles) {
      setSkills(null); setServers(null); setMemory(null); setErrors([])
      return
    }
    let cancelled = false
    setSkills(null); setServers(null); setMemory(null); setErrors([])
    void Promise.allSettled([
      extensions.request<LocalSkill[]>('skills.list'),
      extensions.request<{ servers: McpServer[] }>('mcp.list'),
      personalFiles.read('memory'),
    ]).then(results => {
      if (cancelled) return
      if (results[0].status === 'fulfilled') setSkills(results[0].value)
      if (results[1].status === 'fulfilled') setServers(results[1].value.servers)
      if (results[2].status === 'fulfilled') setMemory(results[2].value)
      setErrors(results.filter(result => result.status === 'rejected').map(result => describeError(result.reason, language)))
    })
    return () => { cancelled = true }
  }, [connected, profiles?.selected, extensions, personalFiles, language])

  const tabs: Array<[Tab, string]> = zh
    ? [['overview', '概览'], ['skills', '技能'], ['mcp', 'MCP'], ['memory', '记忆'], ['data', '数据']]
    : [['overview', 'Overview'], ['skills', 'Skills'], ['mcp', 'MCP'], ['memory', 'Memory'], ['data', 'Data']]
  const skillNames = skills?.filter(skill => skill.enabled).map(skill => skill.name) || []
  const serverNames = servers?.map(server => server.name) || []
  const memoryEntries = memory?.entries || []
  const card = (title: string, action: string, run: () => void, content: React.ReactNode) =>
    <section className="profile-overview-card" aria-label={title}>
      <div className="profile-overview-card-header"><h3>{title}</h3><button type="button" onClick={run}>{action} <span aria-hidden="true">›</span></button></div>
      <div className="profile-overview-card-body">{content}</div>
    </section>
  const skillsContent = skills === null ? (zh ? '读取技能中…' : 'Loading skills…') : skillNames.length
    ? <ul>{skillNames.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul>
    : (zh ? '此 Profile 暂无已启用技能。' : 'No enabled skills in this profile.')
  const mcpContent = servers === null ? (zh ? '读取 MCP 中…' : 'Loading MCP…') : serverNames.length
    ? <ul>{serverNames.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul>
    : (zh ? '此 Profile 暂无 MCP 配置。' : 'No MCP servers in this profile.')
  const memoryContent = memory === null ? (zh ? '读取记忆中…' : 'Loading memory…') : memoryEntries.length
    ? <p>{memoryEntries[0]}</p> : (zh ? '此 Profile 暂无记忆条目。' : 'No memory entries in this profile.')
  const dataContent = sessionsState === 'loading' ? (zh ? '读取会话中…' : 'Loading sessions…')
    : sessionsState === 'error' ? (zh ? '会话读取失败。' : 'Could not load sessions.')
      : (zh ? `${sessions.length} 个会话` : `${sessions.length} sessions`)

  return <div className="profile-overview">
    <div className="profile-breadcrumb">Profile <span>/</span> <strong>{name}</strong></div>
    <div className="profile-heading">
      <div className="profile-identity"><span className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><div><h2>{name}</h2><p><span className={`status-dot ${served ? 'ready' : ''}`} />{!connected ? (zh ? '本地 · 未连接' : 'Local · Disconnected') : served ? (zh ? '本地 Agent · 已运行' : 'Local agent · Running') : (zh ? '等待 Gateway 启用' : 'Waiting for Gateway')}</p></div></div>
      <button className="profile-new-chat" type="button" disabled={!served} onClick={onNewChat}>{zh ? '新建会话' : 'New chat'}</button>
    </div>
    <div className="profile-tabs" role="tablist" aria-label={zh ? 'Profile 内容' : 'Profile content'}>{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {errors.length > 0 && <p className="profile-load-error" role="alert">{zh ? '部分资料读取失败：' : 'Some details could not be loaded: '}{errors.join('；')}</p>}
    {tab === 'overview' && <div className="profile-overview-grid">
      {card(zh ? '技能' : 'Skills', zh ? '管理技能' : 'Manage skills', onOpenSkills, skillsContent)}
      {card('MCP', zh ? '管理 MCP' : 'Manage MCP', onOpenSkills, mcpContent)}
      {card(zh ? '记忆' : 'Memory', zh ? '查看记忆' : 'View memory', onOpenMemory, memoryContent)}
      {card(zh ? '数据' : 'Data', zh ? '查看会话' : 'View sessions', onOpenData, dataContent)}
    </div>}
    {tab === 'skills' && card(zh ? '此 Profile 的技能' : 'Skills in this profile', zh ? '打开技能管理' : 'Open skills', onOpenSkills, skillsContent)}
    {tab === 'mcp' && card(zh ? '此 Profile 的 MCP' : 'MCP in this profile', zh ? '打开 MCP 管理' : 'Open MCP', onOpenSkills, mcpContent)}
    {tab === 'memory' && card(zh ? '此 Profile 的记忆' : 'Memory in this profile', zh ? '打开记忆编辑' : 'Open memory', onOpenMemory, memoryContent)}
    {tab === 'data' && card(zh ? '此 Profile 的数据' : 'Data in this profile', zh ? '查看会话' : 'View sessions', onOpenData, dataContent)}
  </div>
}
