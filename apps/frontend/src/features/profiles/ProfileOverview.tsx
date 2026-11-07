import React from 'react'
import type { PersonalFile, ProfilesSnapshot, ProfileToolset } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { LocalSkill, McpServer } from '../extensions/model'
import ProfileMcp from './ProfileMcp'
import { labels } from '../extensions/labels'
import ProfileDataView from './ProfileDataView'
import ProfileHermesPlugins from './ProfileHermesPlugins'
import ProfileIdentityDialog from './ProfileIdentityDialog'
import ProfileSkillEditor from './ProfileSkillEditor'
import ProfileLearnSkillDialog from './ProfileLearnSkillDialog'
import ProfileToolsetConfig from './ProfileToolsetConfig'
import './profile-skill-editor.css'
import JourneyView from '../journey/JourneyView'

export type ProfileTab = 'overview' | 'tools' | 'skills' | 'plugins' | 'mcp' | 'memory' | 'journey' | 'data'
type CardIconKind = 'tools' | 'settings' | 'skills' | 'mcp' | 'memory' | 'data' | 'channels' | 'usage'

function CardIcon({ kind }: { kind: CardIconKind }) {
  return <span className="profile-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'tools' && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>}
    {kind === 'settings' && <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1m0-14.2L17 7M7 17l-2.1 2.1" /></>}
    {kind === 'skills' && <path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z" />}
    {kind === 'mcp' && <><path d="m9 15 6-6M8 9l-2 2a4 4 0 0 0 5.7 5.7l2-2M16 15l2-2a4 4 0 0 0-5.7-5.7l-2 2" /></>}
    {kind === 'memory' && <><path d="M12 6c-2.3-1.6-5-1.6-9-1v14c4-.6 6.7-.6 9 1 2.3-1.6 5-1.6 9-1V5c-4-.6-6.7-.6-9 1Z" /><path d="M12 6v14" /></>}
    {kind === 'data' && <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z" />}
    {kind === 'channels' && <path d="M4 5h16v11H9l-5 4V5Z" />}
    {kind === 'usage' && <path d="M4 20V12m6 8V8m6 12V4m4 16H2" />}
  </svg></span>
}

type Props = {
  connected: boolean
  epoch: string | null
  profiles: ProfilesSnapshot | null
  activeProfile: string | null
  tabRequest: { id: number; tab: ProfileTab }
  onTabChange: (tab: ProfileTab) => void
  onNewChat: () => void
  onLearnSkill: (command: string) => void
  onDeleteProfile: () => void
  onRenameProfile: () => void
  onRenameProfileId: (name: string, newName: string) => Promise<{ name: string; selection_persisted: boolean; served: boolean; refreshed: boolean }>
  onSaveDescription: (name: string, description: string) => Promise<{ description: string; description_auto: false }>
  onDescribeAuto: (name: string, overwrite: boolean) => Promise<{ ok: boolean; reason: string | null; description: string | null; description_auto: boolean }>
  onExportProfile: () => void
  profileBusy: boolean
  onActivateProfile: (name: string) => Promise<unknown>
  onOpenMemory: () => void
  onOpenSoul: () => void
  onOpenConfiguration: (page: 'advanced-runtime' | 'advanced-tools' | 'memory-persistent') => void
  onOpenChannels: () => void
  onOpenUsage: () => void
  onOpenExtensions: () => void
}

export default function ProfileOverview({ connected, epoch, profiles, activeProfile, tabRequest, onTabChange, onNewChat, onLearnSkill, onDeleteProfile, onRenameProfile, onRenameProfileId, onSaveDescription, onDescribeAuto, onExportProfile, profileBusy, onActivateProfile, onOpenMemory, onOpenSoul, onOpenConfiguration, onOpenChannels, onOpenUsage, onOpenExtensions }: Props) {
  const { extensions, personalFiles, profiles: profileApi } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const extensionLabels = labels(language)
  const workspace = workspaceKey(epoch, profiles?.selected)
  let stateSlot = 0
  const useState = <T,>(initial: T | (() => T)) => useProfileState(workspace, initial, `profile-overview:${stateSlot++}`)
  const [tab, setTab] = useState<ProfileTab>('overview')
  React.useEffect(() => { if (tabRequest.id) setTab(tabRequest.tab) }, [tabRequest.id, tabRequest.tab])
  React.useEffect(() => { onTabChange(tab) }, [onTabChange, tab])
  const [skills, setSkills] = useState<LocalSkill[] | null>(null)
  const [toolsets, setToolsets] = useState<ProfileToolset[] | null>(null)
  const [toolsetConfig, setToolsetConfig] = useState<string | null>(null)
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [memory, setMemory] = useState<PersonalFile | null>(null)
  const [skillQuery, setSkillQuery] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [summaryRevision, setSummaryRevision] = useState(0)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [pendingSkill, setPendingSkill] = useState<string | null>(null)
  const [skillActionError, setSkillActionError] = useState('')
  const [editingSkill, setEditingSkill] = useState<LocalSkill | null | 'new'>(null)
  const [learningSkill, setLearningSkill] = useState(false)
  const [directoryPath, setDirectoryPath] = useState<string | null>(null)
  const [directoryState, setDirectoryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpMessage, setMcpMessage] = useState('')
  const [identityOpen, setIdentityOpen] = useState(false)
  const [activationMessage, setActivationMessage] = useState('')
  const visitedProfiles = React.useRef(new Set<string>())
  const profile = profiles?.profiles.find(item => item.name === profiles.selected)
  const name = profile?.display_name || profile?.name || (zh ? '当前 Profile' : 'Current profile')
  const served = Boolean(connected && profiles?.gateways.some(gateway => gateway.served_profiles?.includes(profiles.selected) || gateway.profile === profiles.selected))
  const active = Boolean(profile && activeProfile === profile.name)

  const activateProfile = async () => {
    if (!profile || active || !served || profileBusy) return
    setActivationMessage('')
    try {
      await onActivateProfile(profile.name)
      setActivationMessage(zh ? '已设为活动 Profile。新建会话和默认管理操作将使用它。' : 'Active Profile updated. New sessions and default management actions will use it.')
    } catch (cause) {
      setActivationMessage(describeError(cause, language))
    }
  }

  React.useEffect(() => {
    if (!served || !profiles) return
    let cancelled = false
    setDirectoryState('loading')
    setDirectoryPath(null)
    void profileApi.dataDirectory({ kind: 'profile', profile: profiles.selected }).then(result => {
      if (cancelled) return
      setDirectoryPath(result.path)
      setDirectoryState('ready')
    }).catch(() => {
      if (cancelled) return
      setDirectoryState('error')
    })
    return () => { cancelled = true }
  }, [served, epoch, profiles?.selected, profileApi])

  React.useEffect(() => {
    if (!served || !profiles) {
      return
    }
    const visited = visitedProfiles.current.has(workspace)
    visitedProfiles.current.add(workspace)
    if (visited && errors.length === 0 && toolsets !== null && skills !== null && servers !== null && memory !== null) return
    let cancelled = false
    setSummaryLoading(true)
    setErrors([])
    void Promise.allSettled([
      profileApi.listToolsets({ kind: 'profile', profile: profiles.selected }),
      extensions.request<LocalSkill[]>({ kind: 'profile', profile: profiles.selected }, 'skills.list'),
      extensions.request<{ servers: McpServer[] }>({ kind: 'profile', profile: profiles.selected }, 'mcp.list'),
      personalFiles.read({ kind: 'profile', profile: profiles.selected }, 'memory'),
    ]).then(results => {
      if (cancelled) return
      if (results[0].status === 'fulfilled') setToolsets(results[0].value)
      if (results[1].status === 'fulfilled') setSkills(results[1].value)
      if (results[2].status === 'fulfilled') setServers(results[2].value.servers)
      if (results[3].status === 'fulfilled') setMemory(results[3].value)
      const names = zh ? ['工具集', '技能', 'MCP', '记忆'] : ['Toolsets', 'Skills', 'MCP', 'Memory']
      setErrors(results.flatMap((result, index) => result.status === 'rejected'
        ? [`${names[index]}：${describeError(result.reason, language)}`]
        : []))
      setSummaryLoading(false)
    })
    return () => { cancelled = true }
  }, [served, epoch, profiles?.selected, extensions, personalFiles, profileApi, language, summaryRevision])

  const tabs: Array<[ProfileTab, string]> = zh
    ? [['overview', '概览'], ['tools', '工具集'], ['skills', '技能'], ['plugins', '插件'], ['mcp', 'MCP'], ['memory', '记忆'], ['journey', '学习时间线'], ['data', '数据目录']]
    : [['overview', 'Overview'], ['tools', 'Toolsets'], ['skills', 'Skills'], ['plugins', 'Plugins'], ['mcp', 'MCP'], ['memory', 'Memory'], ['journey', 'Learning timeline'], ['data', 'Data directory']]
  const enabledToolsets = toolsets?.filter(toolset => toolset.enabled) || []
  const skillNames = skills?.filter(skill => skill.enabled).map(skill => skill.name) || []
  const filteredSkills = skills?.filter(skill => `${skill.name} ${skill.description || ''}`.toLocaleLowerCase().includes(skillQuery.trim().toLocaleLowerCase())) || []
  const toggleSkill = async (skill: LocalSkill) => {
    if (!served || !profiles || pendingSkill) return
    setPendingSkill(skill.name)
    setSkillActionError('')
    const scope = { kind: 'profile' as const, profile: profiles.selected }
    try {
      await extensions.request(scope, 'skills.toggle', { name: skill.name, enabled: !skill.enabled })
      try {
        setSkills(await extensions.request<LocalSkill[]>(scope, 'skills.list'))
      } catch {
        setSkills(current => current?.map(item => item.name === skill.name ? { ...item, enabled: !skill.enabled } : item) || null)
        setSkillActionError(zh ? '设置已保存，但最新列表读取失败。' : 'Setting saved, but the latest list could not be loaded.')
      }
    } catch (error) {
      setSkillActionError(describeError(error, language))
    } finally {
      setPendingSkill(null)
    }
  }
  const runHubSkillAction = async (operation: 'skills.update' | 'skills.uninstall', name?: string) => {
    if (!served || !profiles || pendingSkill) return
    setPendingSkill(name || 'update')
    setSkillActionError('')
    try {
      const scope = { kind: 'profile' as const, profile: profiles.selected }
      const result = await extensions.request<{ name?: string }>(scope, operation, name ? { name } : {})
      if (!result.name) throw new Error(zh ? '未返回后台任务标识。' : 'No background action was returned.')
      let completed = false
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        const status = await extensions.request<{ running: boolean; exit_code: number | null }>(scope, 'actions.status', { name: result.name })
        if (status.running || status.exit_code === null) continue
        if (status.exit_code !== 0) throw new Error(zh ? '技能操作失败。' : 'Skill action failed.')
        completed = true
        break
      }
      if (!completed) throw new Error(zh ? '后台任务仍在运行，请稍后刷新技能列表。' : 'The action is still running. Refresh skills later.')
      setSkills(await extensions.request<LocalSkill[]>(scope, 'skills.list'))
    } catch (error) {
      setSkillActionError(describeError(error, language))
    } finally {
      setPendingSkill(null)
    }
  }
  const requestSkill = React.useCallback(<R,>(operation: string, payload?: Record<string, unknown>): Promise<R> => {
    if (!served || !profiles) return Promise.reject(new Error('Profile is not served by this Gateway'))
    return extensions.request<R>({ kind: 'profile', profile: profiles.selected }, operation, payload)
  }, [served, profiles?.selected, extensions])
  const refreshSkills = async () => {
    try {
      setSkills(await requestSkill<LocalSkill[]>('skills.list'))
    } catch {
      setSkillActionError(zh ? '技能已保存，但最新列表读取失败。' : 'Skill saved, but the latest list could not be loaded.')
    }
  }
  const refreshToolsets = async () => {
    if (!profiles) return
    try {
      setToolsets(await profileApi.listToolsets({ kind: 'profile', profile: profiles.selected }))
    } catch {
      setErrors(current => [...current, zh ? '工具集已保存，但最新列表读取失败。' : 'Toolset saved, but the latest list could not be loaded.'])
    }
  }
  const requestMcp = <R,>(operation: string, payload?: Record<string, unknown>): Promise<R> => {
    if (!served || !profiles) return Promise.reject(new Error('Profile is not served by this Gateway'))
    return extensions.request<R>({ kind: 'profile', profile: profiles.selected }, operation, payload)
  }
  const cancelMcpOAuth = (flowId: string) => {
    if (!served || !profiles) return Promise.reject(new Error('Profile is not served by this Gateway'))
    return extensions.cancelMcpOAuth({ kind: 'profile', profile: profiles.selected }, flowId)
  }
  const refreshMcp = async () => {
    if (mcpBusy || !served) return
    setMcpBusy(true)
    setMcpMessage('')
    try {
      const value = await requestMcp<{ servers: McpServer[] }>('mcp.list')
      setServers(value.servers)
    } catch (error) {
      setMcpMessage(describeError(error, language))
    } finally {
      setMcpBusy(false)
    }
  }
  const runMcp = async (operation: string, payload: Record<string, unknown> = {}): Promise<boolean> => {
    if (mcpBusy || !served) return false
    setMcpBusy(true)
    setMcpMessage('')
    let saved = false
    try {
      await requestMcp(operation, payload)
      saved = true
      const value = await requestMcp<{ servers: McpServer[] }>('mcp.list')
      setServers(value.servers)
      setMcpMessage(extensionLabels('nextSession'))
      return true
    } catch (error) {
      setMcpMessage(saved
        ? (zh ? '设置已保存，但最新 MCP 列表读取失败，请刷新。' : 'Saved, but the latest MCP list could not be loaded. Refresh the list.')
        : describeError(error, language))
      return false
    } finally {
      setMcpBusy(false)
    }
  }
  const serverNames = servers?.map(server => server.name) || []
  const memoryEntries = memory?.entries || []
  const card = (title: string, action: string, run: () => void, content: React.ReactNode, icon?: CardIconKind, disabled = false) =>
    <section className="profile-overview-card" aria-label={title}>
      <div className="profile-overview-card-header">{icon && <CardIcon kind={icon} />}<h3>{title}</h3><button type="button" disabled={disabled} onClick={run}>{action} <span aria-hidden="true">›</span></button></div>
      <div className="profile-overview-card-body">{content}</div>
    </section>
  const unavailable = zh ? '等待 Gateway 启用后读取。' : 'Available after the Gateway serves this profile.'
  const skillsContent = !served ? unavailable : skills === null ? (zh ? '读取技能中…' : 'Loading skills…')
    : <><strong className="profile-card-count">{skills.length}</strong> {zh ? '项技能' : 'skills'}<p>{zh ? `${skillNames.length} 项已启用` : `${skillNames.length} enabled`}</p></>
  const toolsContent = !served ? unavailable : toolsets === null ? (zh ? '读取工具集配置中…' : 'Loading toolset settings…')
    : enabledToolsets.length
      ? <div className="profile-card-tags">{enabledToolsets.slice(0, 3).map(item => <span key={item.name}>{item.label || item.name}</span>)}</div>
      : (zh ? '此 Profile 未启用工具集。' : 'No toolsets enabled in this profile.')
  const mcpContent = !served ? unavailable : servers === null ? (zh ? '读取 MCP 中…' : 'Loading MCP…') : serverNames.length
    ? <ul>{serverNames.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul>
    : (zh ? '此 Profile 暂无 MCP 配置。' : 'No MCP servers in this profile.')
  const memoryContent = !served ? unavailable : memory === null ? (zh ? '读取记忆中…' : 'Loading memory…') : memoryEntries.length
    ? <p>{memoryEntries[0]}</p> : (zh ? '此 Profile 暂无记忆条目。' : 'No memory entries in this profile.')
  const dataContent = <>
    {!served ? (zh ? '运行时未连接或尚未服务此专家。' : 'Runtime disconnected or not serving this expert.')
      : directoryState === 'loading' ? (zh ? '读取数据目录中…' : 'Loading data directory…')
        : directoryState === 'error' ? (zh ? '数据目录不存在或无法读取。' : 'Data directory is missing or unavailable.')
          : <p className="profile-data-path" title={directoryPath || ''}>{directoryPath}</p>}
  </>

  return <div className="profile-overview">
    <div className="profile-breadcrumb">{zh ? '专家管理' : 'Manage experts'} <span aria-hidden="true">/</span> <strong>{name}</strong></div>
    <div className="profile-heading">
      <div className="profile-identity"><span className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><div><h1>{name}</h1><p><span className={`status-dot ${served ? 'ready' : ''}`} />{!connected ? (zh ? '本地 · 未连接' : 'Local · Disconnected') : served ? (zh ? '本地 Agent · 已运行' : 'Local agent · Running') : (zh ? '等待 Gateway 启用' : 'Waiting for Gateway')}</p></div></div>
      <div className="profile-heading-actions">
        {profile && active && <span className="profile-active-badge">{zh ? '当前活动' : 'Active'}</span>}
        {profile && !active && <button className="profile-activate" type="button" disabled={!served || profileBusy} onClick={() => void activateProfile()}>{zh ? '设为活动 Profile' : 'Make active'}</button>}
        {profile && <button className="profile-rename" type="button" disabled={!connected || profileBusy} onClick={() => setIdentityOpen(true)}>{zh ? '身份与职责' : 'Identity & role'}</button>}
        {profile && <button className="profile-rename" type="button" disabled={!connected || profileBusy} onClick={onExportProfile}>{zh ? '导出归档' : 'Export archive'}</button>}
        {profile && <button className="profile-rename" type="button" disabled={!connected || profileBusy} onClick={onRenameProfile}>{zh ? '显示名称' : 'Display name'}</button>}
        {profile && profile.name !== 'default' && <button className="profile-delete" type="button" disabled={!connected || profileBusy} onClick={onDeleteProfile}>{zh ? '删除专家' : 'Delete expert'}</button>}
        <button className="profile-new-chat" type="button" disabled={!served} onClick={onNewChat}>{zh ? '＋ 新建会话' : '＋ New chat'}</button>
      </div>
    </div>
    {activationMessage && <p className="profile-activation-message" role="status">{activationMessage}</p>}
    <div className="profile-tabs" role="tablist" aria-label={zh ? 'Profile 内容' : 'Profile content'}>{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === 'skills' && skills !== null ? ` (${skills.length})` : ''}</button>)}</div>
    {errors.length > 0 && <div className="profile-load-error" role="alert"><span>{zh ? '部分资料读取失败：' : 'Some details could not be loaded: '}{errors.join('；')}</span><button type="button" disabled={summaryLoading} onClick={() => setSummaryRevision(value => value + 1)}>{summaryLoading ? (zh ? '重试中…' : 'Retrying…') : (zh ? '重试' : 'Retry')}</button></div>}
    {tab === 'overview' && <>
      <section className="profile-info-panel" aria-label={zh ? '基本信息' : 'Basic information'}>
        <div className="profile-info-panel-heading"><h3>{zh ? '基本信息' : 'Basic information'}</h3><button type="button" disabled={!served} onClick={() => onOpenConfiguration('advanced-runtime')}>{zh ? '查看配置' : 'View settings'} <span aria-hidden="true">›</span></button></div>
        <dl className="profile-info-list">
          <div><dt>{zh ? '名称' : 'Name'}</dt><dd>{name}</dd></div>
          <div><dt>{zh ? 'Profile 标识' : 'Profile ID'}</dt><dd>{profile?.name || '—'}</dd></div>
          <div><dt>{zh ? '职责说明' : 'Role'}</dt><dd>{profile?.description || (zh ? '尚未填写' : 'Not set')}</dd></div>
          <div><dt>{zh ? '使用模型' : 'Model'}</dt><dd>{profile?.model || (zh ? '未指定' : 'Not specified')}</dd></div>
          <div><dt>{zh ? '运行状态' : 'Runtime status'}</dt><dd><span className={`status-dot ${served ? 'ready' : ''}`} />{!connected ? (zh ? '未连接' : 'Disconnected') : served ? (zh ? 'Gateway 已服务' : 'Served by Gateway') : (zh ? '等待 Gateway 启用' : 'Waiting for Gateway')}</dd></div>
        </dl>
      </section>
      <div className="profile-section-heading"><h3>{zh ? '能力与数据' : 'Capabilities and data'}</h3><p>{zh ? '当前专家的配置和资料' : 'Settings and information for this expert'}</p></div>
      <div className="profile-overview-grid">
      {card(zh ? 'Agent 工具集' : 'Agent toolsets', zh ? '查看工具集' : 'View toolsets', () => setTab('tools'), toolsContent, 'tools')}
      {card(zh ? '运行参数' : 'Runtime parameters', zh ? '查看配置' : 'View settings', () => onOpenConfiguration('advanced-runtime'),
        zh ? '管理此专家的运行参数；模型配置位于统一设置的模型分类。' : 'Manage runtime parameters. Model configuration is in the Models category of Settings.', 'settings', !served)}
      {card(zh ? '技能' : 'Skills', zh ? '查看技能' : 'View skills', () => setTab('skills'), skillsContent, 'skills')}
      {card(zh ? 'Hermes 插件' : 'Hermes plugins', zh ? '查看已安装' : 'View installed', () => setTab('plugins'),
        zh ? '查看并管理此 Agent 已安装的 Hermes 插件。' : 'View and manage Hermes plugins installed for this Agent.', 'skills')}
      {card('MCP', zh ? '管理 MCP' : 'Manage MCP', () => setTab('mcp'), mcpContent, 'mcp')}
      {card(zh ? '记忆' : 'Memory', zh ? '查看记忆' : 'View memory', onOpenMemory, memoryContent, 'memory', !served)}
      {card(zh ? '学习时间线' : 'Learning timeline', zh ? '查看时间线' : 'View timeline', () => setTab('journey'),
        zh ? '查看此专家学到或使用过的 Skill 与记忆记录。' : 'Explore skills learned or used by this expert and its memory records.', 'memory', !served)}
      {card(zh ? '数据目录' : 'Data directory', zh ? '查看目录' : 'Browse folder', () => setTab('data'), dataContent, 'data', !served)}
      {card(zh ? '渠道' : 'Channels', zh ? '管理渠道' : 'Manage channels', onOpenChannels,
        zh ? '查看和管理此专家的消息渠道。' : 'View and manage this expert’s message channels.', 'channels', !served)}
      {card(zh ? '使用统计' : 'Usage', zh ? '查看统计' : 'View usage', onOpenUsage,
        zh ? '查看此专家的使用量和模型统计。' : 'View usage and model statistics for this expert.', 'usage', !served)}
      </div>
    </>}
    {tab === 'journey' && <JourneyView key={workspace} connected={served} profile={profiles?.selected || null} epoch={epoch} embedded />}
    {tab === 'tools' && card(zh ? '此 Profile 的工具集配置' : 'Toolset settings for this profile', zh ? '打开工具设置' : 'Open tool settings', () => onOpenConfiguration('advanced-tools'),
      <><p>{zh ? '这里显示当前 Profile 的配置，不代表某个已有会话实际可调用的工具。' : 'These are this Profile’s settings, not the tools available to a particular existing session.'}</p>
        {toolsets === null ? toolsContent : toolsets.length === 0 ? (zh ? '没有可配置的工具集。' : 'No configurable toolsets.')
          : <div className="toolset-list">{toolsets.map(item => <details key={item.name} className="tool-item">
            <summary><strong>{item.label || item.name}</strong><span>{item.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '未启用' : 'Disabled')}</span></summary>
            {item.description && <p>{item.description}</p>}
            <small>{item.platform_label || item.platform}{item.enabled && !item.configured ? (zh ? ' · 还需完成所需配置' : ' · Additional setup required') : ''}</small>
            {item.tools.length > 0 && <ul>{item.tools.map(tool => <li key={tool}>{tool}</li>)}</ul>}
            <button type="button" disabled={!served} onClick={() => setToolsetConfig(item.name)}>{zh ? '配置提供方' : 'Configure provider'}</button>
          </details>)}</div>}</>, undefined, !served)}
    {tab === 'tools' && toolsetConfig && toolsets?.find(item => item.name === toolsetConfig) && <ProfileToolsetConfig key={`${workspace}:${toolsetConfig}`} toolset={toolsets.find(item => item.name === toolsetConfig)!} language={language} request={requestSkill} onClose={() => setToolsetConfig(null)} onChanged={refreshToolsets} />}
    {tab === 'skills' && <section className="profile-skills-panel" aria-label={zh ? '此 Profile 的技能' : 'Skills in this profile'}>
      <div className="profile-skills-heading"><div><h3>{zh ? '技能' : 'Skills'}</h3><p>{skills === null ? (zh ? '读取技能中…' : 'Loading skills…') : (zh ? `${skills.length} 项技能，${skillNames.length} 项已启用` : `${skills.length} skills, ${skillNames.length} enabled`)}</p></div><div className="profile-skill-heading-actions">{skills?.some(skill => skill.provenance === 'hub') && <button type="button" disabled={!served || pendingSkill !== null} onClick={() => void runHubSkillAction('skills.update')}>{pendingSkill === 'update' ? (zh ? '更新中…' : 'Updating…') : (zh ? '更新市场技能' : 'Update market Skills')}</button>}<button type="button" disabled={!served || learningSkill} onClick={() => setLearningSkill(true)}>{zh ? '学习技能' : 'Learn a skill'}</button><button type="button" disabled={!served || editingSkill !== null || pendingSkill !== null} onClick={() => setEditingSkill('new')}>{zh ? '＋ 新建技能' : '＋ New skill'}</button></div></div>
      <label className="profile-skill-search"><span className="sr-only">{zh ? '搜索技能' : 'Search skills'}</span><input type="search" value={skillQuery} onChange={event => setSkillQuery(event.target.value)} placeholder={zh ? '搜索技能名称或说明' : 'Search skills by name or description'} /></label>
      {skillActionError && <p className="profile-skill-action-error" role="alert">{skillActionError}</p>}
      {editingSkill !== null && <ProfileSkillEditor key={`${workspace}:${editingSkill === 'new' ? 'new' : editingSkill.name}`} skill={editingSkill === 'new' ? null : editingSkill} language={language} request={requestSkill} onClose={() => setEditingSkill(null)} onSaved={refreshSkills} />}
      {learningSkill && <ProfileLearnSkillDialog language={language} onClose={() => setLearningSkill(false)} onLearn={command => { setLearningSkill(false); onLearnSkill(command) }} />}
      {skills !== null && (filteredSkills.length ? <ul className="profile-skill-list">{filteredSkills.map(skill => <li key={skill.name}>
        <div><strong>{skill.name}</strong>{skill.description && <p>{skill.description}</p>}</div>
        <button type="button" className="profile-skill-edit" disabled={!served || editingSkill !== null} onClick={() => setEditingSkill(skill)}>{zh ? '编辑' : 'Edit'}</button>
        {skill.provenance === 'hub' && <button type="button" className="profile-skill-edit" disabled={!served || pendingSkill !== null} onClick={() => { if (window.confirm(zh ? `卸载市场技能 ${skill.name}？` : `Uninstall market Skill ${skill.name}?`)) void runHubSkillAction('skills.uninstall', skill.name) }}>{pendingSkill === skill.name ? (zh ? '卸载中…' : 'Uninstalling…') : (zh ? '卸载' : 'Uninstall')}</button>}
        <button type="button" className="profile-skill-switch" role="switch" aria-checked={skill.enabled}
          aria-label={`${skill.name}：${skill.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Off')}`}
          title={skill.name === 'hermes-agent' ? (zh ? '核心技能始终启用' : 'Core skill is always enabled') : undefined}
          disabled={!served || pendingSkill !== null || skill.name === 'hermes-agent'}
          onClick={() => void toggleSkill(skill)}>
          <span className="profile-skill-switch-status">{pendingSkill === skill.name ? (zh ? '保存中…' : 'Saving…') : skill.name === 'hermes-agent' ? (zh ? '始终启用' : 'Always on') : skill.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Off')}</span>
          <span className="profile-skill-switch-track" aria-hidden="true"><span /></span>
        </button>
      </li>)}</ul> : <p className="profile-skill-empty">{skillQuery.trim() ? (zh ? '没有匹配的技能。' : 'No matching skills.') : (zh ? '此 Profile 暂无技能。' : 'No skills in this profile.')}</p>)}
    </section>}
    {tab === 'plugins' && <ProfileHermesPlugins key={workspace} profile={profiles?.selected || null} served={served} onOpenSources={onOpenExtensions} onOpenMemorySettings={() => onOpenConfiguration('memory-persistent')} />}
    {tab === 'mcp' && <section className="profile-skills-panel profile-mcp-panel" aria-label={zh ? '此 Profile 的 MCP' : 'MCP in this profile'}>
      <div className="profile-skills-heading"><div><h3>{zh ? '此 Profile 的 MCP' : 'MCP in this profile'}</h3><p>{servers === null ? (zh ? '读取 MCP 中…' : 'Loading MCP…') : (zh ? `${servers.length} 个已配置 MCP` : `${servers.length} configured MCP servers`)}</p></div>
        <button type="button" disabled={!served || mcpBusy} onClick={() => void refreshMcp()}>{zh ? '刷新' : 'Refresh'}</button></div>
      {mcpMessage && <p className="profile-skill-action-error" role="status">{mcpMessage}</p>}
      {!served ? <p>{zh ? '运行时未连接或尚未服务此专家。' : 'Runtime disconnected or not serving this expert.'}</p>
        : servers === null ? <p>{zh ? '读取 MCP 中…' : 'Loading MCP…'}</p>
          : <ProfileMcp key={workspace} servers={servers} busy={mcpBusy} t={extensionLabels} request={requestMcp}
            cancelOAuth={cancelMcpOAuth}
            run={runMcp} onMessage={setMcpMessage} />}
    </section>}
    {tab === 'memory' && card(zh ? '此 Profile 的记忆' : 'Memory in this profile', zh ? '打开记忆编辑' : 'Open memory', onOpenMemory, memoryContent, undefined, !served)}
    {tab === 'data' && <ProfileDataView key={workspace} profile={profiles?.selected || null} served={served} />}
    {identityOpen && profile && <ProfileIdentityDialog key={profile.name} profile={profile} language={language} busy={profileBusy}
      onRenameId={onRenameProfileId} onSaveDescription={onSaveDescription} onDescribeAuto={onDescribeAuto}
      onOpenSoul={onOpenSoul} onClose={() => setIdentityOpen(false)} />}
  </div>
}
