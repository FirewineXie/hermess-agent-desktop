import React from 'react'
import type { ModelProvider, ProfileCreateOptions, ProfileMcpServerCreate } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { LocalSkill, HubSkill } from '../extensions/model'

type AdvancedOptions = Pick<ProfileCreateOptions, 'provider' | 'model' | 'noSkills' | 'keepSkills' | 'hubSkills' | 'mcpServers'>
type Props = {
  language: 'zh-CN' | 'en-US'
  sourceProfile: string | null
  cloning: boolean
  disabled: boolean
  value: AdvancedOptions
  onChange(value: AdvancedOptions): void
}

const profileScope = (profile: string) => ({ kind: 'profile' as const, profile })

export default function ProfileCreateAdvancedOptions({ language, sourceProfile, cloning, disabled, value, onChange }: Props) {
  const { models, extensions } = useDesktop()
  const zh = language === 'zh-CN'
  const [providers, setProviders] = React.useState<ModelProvider[]>([])
  const [skills, setSkills] = React.useState<LocalSkill[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [hubQuery, setHubQuery] = React.useState('')
  const [hubResults, setHubResults] = React.useState<HubSkill[]>([])
  const [hubSearching, setHubSearching] = React.useState(false)
  const [transport, setTransport] = React.useState<'http' | 'stdio'>('http')
  const [mcpName, setMcpName] = React.useState('')
  const [mcpTarget, setMcpTarget] = React.useState('')
  const [mcpArgs, setMcpArgs] = React.useState('')
  const [mcpEnv, setMcpEnv] = React.useState('')
  const [mcpAuth, setMcpAuth] = React.useState<'none' | 'oauth' | 'header'>('none')
  const [mcpToken, setMcpToken] = React.useState('')

  React.useEffect(() => {
    if (!sourceProfile) return
    let active = true
    setLoading(true); setError('')
    const scope = profileScope(sourceProfile)
    void Promise.all([
      models.options(scope, { refresh: false }),
      extensions.request<LocalSkill[]>(scope, 'skills.list'),
    ]).then(([modelResult, skillResult]) => {
      if (!active) return
      setProviders(modelResult.providers)
      setSkills(skillResult)
    }).catch(cause => { if (active) setError(describeError(cause, language)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [sourceProfile, models, extensions, language])

  const patch = (next: Partial<AdvancedOptions>) => onChange({ ...value, ...next })
  const modelValue = value.provider && value.model ? `${value.provider}\u0000${value.model}` : ''
  const selectModel = (selected: string) => {
    if (!selected) { patch({ provider: undefined, model: undefined }); return }
    const [provider, model] = selected.split('\u0000')
    patch({ provider, model })
  }
  const toggleCustomSkills = (enabled: boolean) => {
    patch({
      noSkills: enabled ? false : value.noSkills,
      keepSkills: enabled ? skills.filter(skill => skill.enabled).map(skill => skill.name) : undefined,
    })
  }
  const toggleSkill = (name: string, enabled: boolean) => {
    const current = new Set(value.keepSkills || [])
    if (enabled) current.add(name); else current.delete(name)
    patch({ keepSkills: [...current] })
  }
  const searchHub = async () => {
    if (!sourceProfile || !hubQuery.trim() || hubSearching) return
    setHubSearching(true); setError('')
    try {
      const result = await extensions.request<{ results: HubSkill[] }>(
        profileScope(sourceProfile), 'skills.search', { q: hubQuery.trim(), source: 'all' })
      setHubResults(result.results || [])
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setHubSearching(false) }
  }
  const toggleHub = (identifier: string) => {
    const current = new Set(value.hubSkills || [])
    if (current.has(identifier)) current.delete(identifier); else current.add(identifier)
    patch({ hubSkills: [...current] })
  }
  const addMcp = () => {
    const name = mcpName.trim()
    const target = mcpTarget.trim()
    if (!name || !target || (transport === 'http' && mcpAuth === 'header' && !mcpToken.trim())) return
    let server: ProfileMcpServerCreate
    try {
      server = transport === 'http'
        ? { name, url: target, auth: mcpAuth, ...(mcpAuth === 'header' ? { bearer_token: mcpToken.trim() } : {}) }
        : { name, command: target, args: mcpArgs.split('\n').map(item => item.trim()).filter(Boolean), env: parseEnv(mcpEnv) }
    } catch {
      setError(zh ? '环境变量必须按 KEY=VALUE 每行填写一项。' : 'Environment entries must use one KEY=VALUE pair per line.')
      return
    }
    setError('')
    patch({ mcpServers: [...(value.mcpServers || []).filter(item => item.name !== name), server] })
    setMcpName(''); setMcpTarget(''); setMcpArgs(''); setMcpEnv(''); setMcpToken(''); setMcpAuth('none')
  }

  return <details className="profile-create-advanced">
    <summary>{zh ? '创建期高级配置' : 'Advanced creation settings'}</summary>
    <p>{zh ? '这些选项与 Profile 一次创建；创建后仍可在设置、技能和 MCP 页面修改。' : 'Apply these options in the same Profile creation. You can still change them later in Settings, Skills, and MCP.'}</p>
    {loading && <p role="status">{zh ? '正在读取可用模型和技能…' : 'Loading available models and skills…'}</p>}
    {error && <p className="profile-directory-error" role="alert">{error}</p>}
    <label>{zh ? '初始模型（可选）' : 'Initial model (optional)'}<select disabled={disabled || loading} value={modelValue} onChange={event => selectModel(event.target.value)}>
      <option value="">{zh ? '创建后在设置中配置' : 'Configure later in Settings'}</option>
      {providers.flatMap(provider => provider.models.map(model => <option key={`${provider.slug}:${model}`} value={`${provider.slug}\u0000${model}`}>{provider.name} · {model}</option>))}
    </select></label>
    <label className="profile-create-check"><input type="checkbox" disabled={disabled || cloning} checked={Boolean(value.noSkills)} onChange={event => patch({ noSkills: event.target.checked, keepSkills: event.target.checked ? undefined : value.keepSkills })} /><span><strong>{zh ? '仅保留核心技能' : 'Keep only essential Skills'}</strong><small>{cloning ? (zh ? '克隆会复制来源技能，不能同时选择核心技能模式。' : 'Cloning copies source Skills and cannot use essential-only mode.') : (zh ? '跳过可选内置技能；核心 hermes-agent 技能保留，市场技能仍可在下方安装。' : 'Skip optional bundled Skills, retain the essential hermes-agent Skill, and optionally install Hub Skills below.')}</small></span></label>
    {!value.noSkills && <fieldset><legend>{zh ? '内置技能' : 'Bundled Skills'}</legend>
      <label className="profile-create-check"><input type="checkbox" disabled={disabled || loading} checked={value.keepSkills !== undefined} onChange={event => toggleCustomSkills(event.target.checked)} /><span><strong>{zh ? '自定义启用集合' : 'Choose enabled Skills'}</strong><small>{zh ? '未勾选时保留完整技能包。' : 'Leave off to keep the full bundle.'}</small></span></label>
      {value.keepSkills !== undefined && <div className="profile-create-choice-list">{skills.map(skill => <label key={skill.name}><input type="checkbox" disabled={disabled} checked={value.keepSkills?.includes(skill.name)} onChange={event => toggleSkill(skill.name, event.target.checked)} />{skill.name}</label>)}</div>}
    </fieldset>}
    <fieldset><legend>{zh ? '市场技能' : 'Hub Skills'}</legend><div className="profile-create-inline"><input disabled={disabled} value={hubQuery} onChange={event => setHubQuery(event.target.value)} placeholder={zh ? '搜索技能市场' : 'Search the Skills hub'} /><button type="button" disabled={disabled || hubSearching || !hubQuery.trim()} onClick={() => void searchHub()}>{hubSearching ? (zh ? '搜索中…' : 'Searching…') : (zh ? '搜索' : 'Search')}</button></div>
      <div className="profile-create-choice-list">{hubResults.map(skill => <label key={skill.identifier}><input type="checkbox" disabled={disabled} checked={value.hubSkills?.includes(skill.identifier) || false} onChange={() => toggleHub(skill.identifier)} /><span><strong>{skill.name}</strong><small>{skill.identifier}</small></span></label>)}</div>
      {(value.hubSkills || []).length > 0 && <small>{zh ? `已选择 ${value.hubSkills?.length} 项，创建后后台安装。` : `${value.hubSkills?.length} selected; installation starts after creation.`}</small>}
    </fieldset>
    <fieldset><legend>MCP</legend><label>{zh ? '传输方式' : 'Transport'}<select disabled={disabled} value={transport} onChange={event => setTransport(event.target.value as 'http' | 'stdio')}><option value="http">HTTP</option><option value="stdio">stdio</option></select></label>
      <label>{zh ? '名称' : 'Name'}<input disabled={disabled} value={mcpName} onChange={event => setMcpName(event.target.value)} /></label>
      <label>{transport === 'http' ? 'URL' : (zh ? '命令' : 'Command')}<input disabled={disabled} value={mcpTarget} onChange={event => setMcpTarget(event.target.value)} /></label>
      {transport === 'http' ? <><label>{zh ? '认证' : 'Authentication'}<select disabled={disabled} value={mcpAuth} onChange={event => setMcpAuth(event.target.value as typeof mcpAuth)}><option value="none">None</option><option value="oauth">OAuth</option><option value="header">Bearer token</option></select></label>{mcpAuth === 'header' && <label>Bearer token<input type="password" autoComplete="off" disabled={disabled} value={mcpToken} onChange={event => setMcpToken(event.target.value)} /></label>}</>
        : <><label>{zh ? '参数（每行一个）' : 'Arguments (one per line)'}<textarea disabled={disabled} value={mcpArgs} onChange={event => setMcpArgs(event.target.value)} /></label><label>{zh ? '环境变量（KEY=VALUE，每行一个）' : 'Environment (KEY=VALUE, one per line)'}<textarea disabled={disabled} value={mcpEnv} onChange={event => setMcpEnv(event.target.value)} /></label></>}
      <button type="button" disabled={disabled || !mcpName.trim() || !mcpTarget.trim() || transport === 'http' && mcpAuth === 'header' && !mcpToken.trim()} onClick={addMcp}>{zh ? '加入创建清单' : 'Add to creation'}</button>
      <div className="profile-create-mcp-list">{(value.mcpServers || []).map(server => <div key={server.name}><code>{server.name}</code><span>{server.url || server.command}</span><button type="button" disabled={disabled} onClick={() => patch({ mcpServers: value.mcpServers?.filter(item => item.name !== server.name) })}>{zh ? '移除' : 'Remove'}</button></div>)}</div>
    </fieldset>
  </details>
}

function parseEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error('invalid environment entry')
    const key = line.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('invalid environment entry')
    result[key] = line.slice(separator + 1).trim()
  }
  return result
}
