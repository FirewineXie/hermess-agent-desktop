import React from 'react'
import type { DelegationRouting, AgentConfigSchema, DelegationModelRoute } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { parseConfigFieldDraft } from '../agent-settings/memoryContextModel'
import { getField, fieldText, leafLabel } from '../agent-settings/model'
import { delegationError, parseOverrides, routesMatch } from './delegationModel'
import './delegation.css'

type Props = { connected: boolean; profile: string | null; language: Language; providers: Array<{ slug: string; name: string; models: string[] }>; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void }
export default function DelegationSettings({ connected, profile, language, providers, onDirtyChange, onBusyChange }: Props) {
  const { delegation, agentSettings } = useDesktop()
  const zh = language === 'zh-CN'
  const [draft, setDraft] = React.useState<DelegationRouting | null>(null)
  const [schema, setSchema] = React.useState<AgentConfigSchema | null>(null)
  const [config, setConfig] = React.useState<Record<string, unknown>>({})
  const [defaults, setDefaults] = React.useState<Record<string, string>>({})
  const [overrides, setOverrides] = React.useState<Record<number, string>>({})
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const generation = React.useRef(0)
  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  const load = async () => {
    if (!connected || !profile) return
    const request = ++generation.current
    setBusy(true); setStatus('')
    try {
      const scope = { kind: 'profile' as const, profile }
      const [routing, fields, values] = await Promise.all([delegation.read(scope), agentSettings.schema(scope), agentSettings.config(scope)])
      if (request !== generation.current) return
      setDraft(routing); setSchema(fields); setConfig(values); setDefaults({}); setOverrides({}); setDirty(false)
    } catch (error) { if (request === generation.current) setStatus(describeError(error, language)) }
    finally { if (request === generation.current) setBusy(false) }
  }
  React.useEffect(() => { setDraft(null); setDirty(false); void load(); return () => { ++generation.current } }, [connected, profile])
  const update = (next: DelegationRouting) => { setDraft(next); setDirty(true) }
  const changeRoute = (index: number, patch: Partial<DelegationModelRoute>) => {
    if (!draft) return
    update({ ...draft, model_map: { ...draft.model_map, options: draft.model_map.options.map((row, i) => i === index ? { ...row, original_name: row.original_name || row.name, ...patch } : row) } })
  }
  const save = async () => {
    if (!draft || !profile || busy) return
    const request = generation.current
    setBusy(true); setStatus('')
    try {
      const payload = structuredClone(draft)
      payload.model_map.default = payload.model_map.default?.trim() || null
      payload.profile_routes.default = payload.profile_routes.default?.trim() || null
      payload.model_map.options = payload.model_map.options.map(row => ({ ...row, name: row.name.trim(), description: row.description.trim(), model: row.model.trim(), provider: row.provider?.trim(), base_url: row.base_url?.trim() }))
      if (payload.configured === 'model_map') payload.model_map.options = payload.model_map.options.map((row, i) => ({ ...row, request_overrides: parseOverrides(overrides[i] ?? JSON.stringify(row.request_overrides || {})) }))
      const invalid = delegationError(payload); if (invalid) throw new Error(invalid)
      const scope = { kind: 'profile' as const, profile }
      const parsed = Object.entries(defaults).map(([key, text]) => {
        const field = schema?.fields[key]
        if (!field) throw new Error(`${key}：字段已不存在`)
        if (field.type === 'boolean' && !['true','false'].includes(text)) throw new Error(`${key}：只能填写 true 或 false`)
        const value = parseConfigFieldDraft(text, field)
        return [key, value] as const
      })
      for (const [key, value] of parsed) await agentSettings.saveField(scope, key, value)
      const result = await delegation.save(scope, payload)
      const readback = await agentSettings.config(scope)
      if (request !== generation.current) return
      if (!result.activated) throw new Error('路由配置已保存，但活动策略切换失败。请重新读取检查。')
      if (!routesMatch(payload, result.routing) || parsed.some(([key, value]) => JSON.stringify(getField(readback, key)) !== JSON.stringify(value))) throw new Error('已提交，但回读结果不一致。请重新读取检查，勿重复提交。')
      setDraft(result.routing); setConfig(readback); setDefaults({}); setOverrides({}); setDirty(false); setStatus(zh ? '已保存并核实。' : 'Saved and verified.')
    } catch (error) { if (request === generation.current) setStatus(error instanceof Error ? error.message : describeError(error, language)) }
    finally { if (request === generation.current) setBusy(false) }
  }
  if (!connected || !profile) return <p>{zh ? '请先连接运行时并选择 Profile。' : 'Connect the runtime and select a Profile.'}</p>
  if (!draft) return <div><p role="status">{status || (zh ? '正在读取委派路由…' : 'Loading delegation routes…')}</p><button disabled={busy} onClick={() => void load()}>{zh ? '重试' : 'Retry'}</button></div>
  const modelMode = draft.configured === 'model_map'
  const defaultValue = modelMode ? draft.model_map.default : draft.profile_routes.default
  const rows = modelMode ? draft.model_map.options : draft.profile_routes.profiles
  const defaultFields = Object.entries(schema?.fields || {}).filter(([key, field]) => key.startsWith('delegation.') && key !== 'delegation.backend' && !key.startsWith('delegation.backends.') && !/(api_key|key_env)/.test(key) && ['string','boolean','number','list','object'].includes(field.type))
  const changeDefault = (key: string, value: string) => { setDefaults(previous => ({ ...previous, [key]: value })); setDirty(true) }
  const placeholder = (type: string) => zh
    ? ({ string: '请输入文本', number: '请输入数字', list: '请输入 JSON 数组', object: '请输入 JSON 对象' } as Record<string, string>)[type]
    : ({ string: 'Enter text', number: 'Enter a number', list: 'Enter a JSON array', object: 'Enter a JSON object' } as Record<string, string>)[type]
  return <section className="delegation-settings settings-form-page">
    <div className="row"><h2>{zh ? '委派路由' : 'Delegation routing'}</h2><button disabled={busy} onClick={() => { if (!dirty || window.confirm(zh ? '放弃未保存修改？' : 'Discard changes?')) void load() }}>{zh ? '重新读取' : 'Reload'}</button></div>
    <p>{zh ? '决定子 Agent 使用默认模型、指定模型路由，或其他 Profile。编辑后保存才生效。' : 'Route subagents through default settings, model routes, or other Profiles. Changes apply after saving.'}</p>
    <fieldset disabled={busy}><label>{zh ? '路由策略' : 'Routing strategy'}<select value={draft.configured} onChange={e => { if (dirty) { setStatus(zh ? '请先保存或重新读取，再切换策略。' : 'Save or reload before changing strategy.'); return } update({ ...draft, configured: e.target.value }) }}>
      {!draft.backends.some(b => b.name === draft.configured) && <option value={draft.configured}>{draft.configured}（不可用）</option>}
      {draft.backends.filter(b => ['default', 'model_map', 'profile_routes'].includes(b.name)).map(b => <option key={b.name} value={b.name} disabled={!b.available}>{({ default: zh ? '默认策略' : 'Default', model_map: zh ? '按模型路由' : 'Model routes', profile_routes: zh ? '按 Profile 路由' : 'Profile routes' } as Record<string,string>)[b.name]}{!b.available ? ` · ${b.reason || '不可用'}` : ''}</option>)}
    </select></label>
    {draft.blocked_reason && <p role="alert">{draft.blocked_reason}</p>}
    {draft.configured === 'default' ? <div className="delegation-defaults">{defaultFields.map(([key, field]) => {
      const value = defaults[key] ?? fieldText(getField(config, key), field.type)
      return <label key={key} title={key}>{leafLabel(language, key)}
        {field.type === 'boolean'
          ? <select value={value} onChange={e => changeDefault(key, e.target.value)}>
            {value === '' && <option value="">{zh ? '未设置' : 'Not set'}</option>}
            <option value="true">{zh ? '开启' : 'On'}</option>
            <option value="false">{zh ? '关闭' : 'Off'}</option>
          </select>
          : <input type={field.type === 'number' ? 'number' : 'text'} value={value} onChange={e => changeDefault(key, e.target.value)} placeholder={placeholder(field.type)} />}
      </label>
    })}</div> : <>
      <label>{zh ? '默认路由' : 'Default route'}<select value={defaultValue || ''} onChange={e => update(modelMode ? { ...draft, model_map: { ...draft.model_map, default: e.target.value || null } } : { ...draft, profile_routes: { ...draft.profile_routes, default: e.target.value || null } })}><option value="">{zh ? '由运行时选择' : 'Runtime choice'}</option>{rows.map((r,i) => <option key={i} value={r.name}>{r.name}</option>)}</select></label>
      {modelMode ? draft.model_map.options.map((route, index) => <article className="delegation-route" key={index}>
        <div className="row"><strong>{zh ? `模型路由 ${index + 1}` : `Model route ${index + 1}`}</strong><button onClick={() => { update({ ...draft, model_map: { ...draft.model_map, default: draft.model_map.default === route.name ? null : draft.model_map.default, options: draft.model_map.options.filter((_,i) => i !== index) } }); setOverrides(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => Number(key) !== index).map(([key,value]) => [Number(key) > index ? Number(key)-1 : Number(key), value]))) }}>{zh ? '删除路由' : 'Remove'}</button></div>
        <div className="delegation-grid">
          <label>{zh ? '名称' : 'Name'}<input value={route.name} onChange={e => { const name = e.target.value; changeRoute(index, { name }); if (draft.model_map.default === route.name) update({ ...draft, model_map: { default: name, options: draft.model_map.options.map((r,i) => i === index ? { ...r, original_name: r.original_name || r.name, name } : r) } }) }} /></label>
          <label>{zh ? '任务描述' : 'Task description'}<input value={route.description} onChange={e => changeRoute(index, { description: e.target.value })} /></label>
          <label>{zh ? '提供商' : 'Provider'}<input list="delegation-providers" value={route.provider || ''} onChange={e => changeRoute(index, { provider: e.target.value })} /></label>
          <label>{zh ? '模型 ID' : 'Model ID'}<input list={`delegation-models-${index}`} value={route.model} onChange={e => changeRoute(index, { model: e.target.value })} /><datalist id={`delegation-models-${index}`}>{providers.find(p => p.slug === route.provider)?.models.map(id => <option key={id} value={id} />)}</datalist></label>
          <label>{zh ? '自定义地址' : 'Custom URL'}<input value={route.base_url || ''} onChange={e => changeRoute(index, { base_url: e.target.value })} /></label>
          <label>API 模式<select value={route.api_mode || ''} onChange={e => changeRoute(index, { api_mode: e.target.value })}>{['','chat_completions','codex_responses','anthropic_messages'].map(value => <option key={value} value={value}>{value || '自动'}</option>)}</select></label>
          <label>{zh ? '推理强度' : 'Reasoning effort'}<select value={route.reasoning_effort || ''} onChange={e => changeRoute(index, { reasoning_effort: e.target.value })}>{['','none','minimal','low','medium','high','xhigh','max','ultra'].map(value => <option key={value} value={value}>{value || '默认'}</option>)}</select></label>
          <label>{zh ? '模型请求速度' : 'Request speed'}<select value={route.service_tier || ''} onChange={e => changeRoute(index, { service_tier: e.target.value })}>{['','normal','fast','ultrafast'].map(value => <option key={value} value={value}>{value || '默认'}</option>)}</select></label>
          <label>{zh ? `路由密钥（${route.has_api_key ? '已配置' : '未配置'}）` : `Credential (${route.has_api_key ? 'configured' : 'empty'})`}<select value={route.credential?.action || 'keep'} onChange={e => changeRoute(index, { credential: { action: e.target.value as 'keep'|'clear'|'replace' } })}><option value="keep">{zh ? '保留' : 'Keep'}</option><option value="replace">{zh ? '替换' : 'Replace'}</option><option value="clear">{zh ? '清除' : 'Clear'}</option></select></label>
          {route.credential?.action === 'replace' && <label>{zh ? '新密钥' : 'New credential'}<input type="password" autoComplete="new-password" value={route.credential.value || ''} onChange={e => changeRoute(index, { credential: { action: 'replace', value: e.target.value } })} /></label>}
        </div>
        <h3>{zh ? '有序回退模型' : 'Ordered fallbacks'}</h3>
        {(route.fallback_providers || []).map((fallback,i) => <div className="delegation-fallback" key={i}><input aria-label="提供商" placeholder="提供商" value={fallback.provider} onChange={e => changeRoute(index, { fallback_providers: route.fallback_providers!.map((r,j) => j === i ? { ...r, provider:e.target.value } : r) })} /><input aria-label="模型" placeholder="模型" value={fallback.model} onChange={e => changeRoute(index, { fallback_providers: route.fallback_providers!.map((r,j) => j === i ? { ...r, model:e.target.value } : r) })} /><button disabled={i === 0} onClick={() => { const next = [...route.fallback_providers!]; [next[i-1],next[i]] = [next[i],next[i-1]]; changeRoute(index, { fallback_providers:next }) }}>↑</button><button onClick={() => changeRoute(index, { fallback_providers:route.fallback_providers!.filter((_,j) => i !== j) })}>移除</button></div>)}
        <button onClick={() => changeRoute(index, { fallback_providers:[...(route.fallback_providers || []),{provider:'',model:''}] })}>{zh ? '添加回退' : 'Add fallback'}</button>
        <label>{zh ? '请求覆盖参数（JSON 对象）' : 'Request overrides (JSON object)'}<textarea value={overrides[index] ?? JSON.stringify(route.request_overrides || {},null,2)} onChange={e => { setOverrides(previous => ({ ...previous,[index]:e.target.value })); setDirty(true) }} /></label>
      </article>) : draft.profile_routes.profiles.map((route,index) => <div className="delegation-route delegation-grid" key={index}><label>Profile<select value={route.name} onChange={e => update({ ...draft, profile_routes: { ...draft.profile_routes, default: draft.profile_routes.default === route.name ? e.target.value : draft.profile_routes.default, profiles:draft.profile_routes.profiles.map((r,i) => i === index ? {...r,name:e.target.value}:r) } })}><option value="">选择 Profile</option>{draft.profiles.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>任务描述<input value={route.description || ''} onChange={e => update({ ...draft, profile_routes: { ...draft.profile_routes, profiles:draft.profile_routes.profiles.map((r,i) => i === index ? {...r,description:e.target.value}:r) } })} /></label><button onClick={() => update({ ...draft, profile_routes:{ ...draft.profile_routes, default:draft.profile_routes.default === route.name ? null : draft.profile_routes.default, profiles:draft.profile_routes.profiles.filter((_,i) => i !== index) } })}>删除路由</button></div>)}
      <button onClick={() => { update(modelMode ? { ...draft, model_map:{...draft.model_map,options:[...draft.model_map.options,{ name:'',description:'',provider:providers[0]?.slug || '',model:providers[0]?.models[0] || '' }]} } : { ...draft, profile_routes:{...draft.profile_routes,profiles:[...draft.profile_routes.profiles,{name:'',description:''}]} }) }}>{zh ? '添加路由' : 'Add route'}</button>
    </>}
    <datalist id="delegation-providers">{providers.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</datalist>
    </fieldset><div className="actions"><button className="primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存并核实' : 'Save and verify')}</button></div><p role="status">{status}</p>
  </section>
}
