import React from 'react'
import type { DelegationRouting } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { parseRouteOverrides, routeFallbacks, updateModelRoute } from './delegationRoute'
import '../settings/settings-extra.css'

export default function DelegationRoutingSettings({ profile, connected, onDirtyChange }: { profile: string | null; connected: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const { delegation } = useDesktop()
  const language = useLanguage()
  const [routing, setRouting] = React.useState<DelegationRouting | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [overrideDrafts, setOverrideDrafts] = React.useState<Record<number, string>>({})
  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  React.useEffect(() => {
    let active = true
    setRouting(null); setDirty(false); setStatus(''); setOverrideDrafts({})
    if (!connected || !profile) return () => { active = false }
    setLoading(true)
    void delegation.routing({ kind: 'profile', profile }).then(value => { if (active) setRouting(value) })
      .catch(error => { if (active) setStatus(describeError(error, language)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [connected, profile, delegation])
  const scope = profile ? { kind: 'profile' as const, profile } : null
  const reload = async () => { if (scope) { setRouting(await delegation.routing(scope)); setOverrideDrafts({}); setDirty(false) } }
  const select = async (backend: string) => {
    if (!scope || dirty || busy) return
    setBusy(true)
    try { await delegation.selectBackend(scope, backend); await reload(); setStatus(language === 'zh-CN' ? '委派路由已更新' : 'Delegation routing updated') }
    catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (!scope || !routing || !dirty) return
    const invalidModelRoute = routing.model_map.options.some(row => {
      const hasTarget = Boolean(row.provider?.trim() || (typeof row.base_url === 'string' && row.base_url.trim()))
      return !row.name.trim() || !row.description.trim() || !row.model.trim() || !hasTarget
    })
    if (routing.configured === 'model_map' && invalidModelRoute) {
      setStatus(language === 'zh-CN' ? '每条模型路由必须填写名称、任务描述、模型 ID，以及提供商或地址' : 'Every model route needs a name, task description, model ID, and provider or URL')
      return
    }
    const invalidUrl = routing.model_map.options.some(row => {
      const address = row.base_url?.trim()
      if (!address) return false
      try {
        const url = new URL(address)
        return !['http:', 'https:'].includes(url.protocol) || !url.hostname || Boolean(url.username || url.password || url.hash)
      } catch { return true }
    })
    if (routing.configured === 'model_map' && invalidUrl) {
      setStatus(language === 'zh-CN' ? '自定义模型地址必须是有效的 HTTP 或 HTTPS URL' : 'Custom model URLs must be valid HTTP or HTTPS URLs')
      return
    }
    if (routing.configured === 'model_map' && routing.model_map.options.some(row => routeFallbacks(row.fallback_providers).some(item => !item.provider.trim() || !item.model.trim()))) {
      setStatus(language === 'zh-CN' ? '每条回退模型都需要提供商和模型 ID' : 'Every fallback needs a provider and model ID')
      return
    }
    const parsedOptions = routing.model_map.options.map((row, index) => {
      const draft = overrideDrafts[index]
      if (draft === undefined) return row
      const parsed = new TextEncoder().encode(draft).length <= 16384 ? parseRouteOverrides(draft) : null
      return parsed === null ? null : { ...row, request_overrides: parsed }
    })
    if (routing.configured === 'model_map' && parsedOptions.some(row => row === null)) {
      setStatus(language === 'zh-CN' ? '请求覆盖参数必须是有效的 JSON 对象，且不超过 16 KiB' : 'Request overrides must be a JSON object under 16 KiB')
      return
    }
    const routeNames = routing.model_map.options.map(row => row.name.trim())
    if (routing.configured === 'model_map' && new Set(routeNames).size !== routeNames.length) {
      setStatus(language === 'zh-CN' ? '模型路由名称不能重复' : 'Model route names must be unique')
      return
    }
    setBusy(true)
    try {
      if (routing.configured === 'model_map') await delegation.saveModelMap(scope, { ...routing.model_map, options: parsedOptions as DelegationRouting['model_map']['options'] })
      else if (routing.configured === 'profile_routes') await delegation.saveProfileRoutes(scope, routing.profile_routes)
      await reload()
      setStatus(language === 'zh-CN' ? '路由已保存并重新读取' : 'Routes saved and reloaded')
    } catch (error) { setStatus(describeError(error, language)) }
    finally { setBusy(false) }
  }
  if (!connected || !profile) return null
  if (loading) return <p role="status">{language === 'zh-CN' ? '正在读取委派路由…' : 'Loading delegation routing…'}</p>
  if (!routing) return <p role="status">{status || (language === 'zh-CN' ? '委派路由不可用' : 'Delegation routing unavailable')}</p>
  const update = (next: DelegationRouting) => { setRouting(next); setDirty(true) }
  const changeRoute = (index: number, changes: Partial<DelegationRouting['model_map']['options'][number]>) => update(updateModelRoute(routing, index, changes))
  return <section className="delegation-routing-settings">
    <h2>{language === 'zh-CN' ? '委派路由策略' : 'Delegation routing strategy'}</h2>
    <p>{language === 'zh-CN' ? '仅可选择当前 Gateway 已注册且可用的后端。非默认后端接管子 Agent 的模型选择。' : 'Only registered and available backends can be selected. Non-default backends own subagent model selection.'}</p>
    <div className="delegation-modes">{[...routing.backends, ...(routing.backends.some(item => item.name === routing.configured) ? [] : [{ name: routing.configured, label: routing.configured, description: '', available: false, reason: '', builtin: false }])].map(item => <label key={item.name}><input type="radio" name="delegation-backend" checked={routing.configured === item.name} disabled={busy || dirty || !item.available} onChange={() => void select(item.name)} /><span><strong>{item.label || item.name}</strong><small>{item.description}{!item.available && ` · ${item.reason || (language === 'zh-CN' ? '不可用' : 'Unavailable')}`}</small></span></label>)}</div>
    {routing.blocked_reason && <p role="alert">{language === 'zh-CN' ? '当前路由阻塞所有委派：' : 'Current routing blocks delegation: '}{routing.blocked_reason}</p>}
    {routing.configured === 'model_map' && <div className="delegation-routes">
      <h3>{language === 'zh-CN' ? '命名模型路由' : 'Named model routes'}</h3>
      {routing.model_map.options.map((row, index) => {
        const fallbacks = routeFallbacks(row.fallback_providers)
        return <div className="delegation-route-row" key={index}>
        <label>{language === 'zh-CN' ? '名称' : 'Name'}<input value={row.name} onChange={event => changeRoute(index, { name: event.target.value })} /></label>
        <label>{language === 'zh-CN' ? '任务描述' : 'Task description'}<input value={row.description} onChange={event => changeRoute(index, { description: event.target.value })} /></label>
        <label>{language === 'zh-CN' ? '提供商' : 'Provider'}<input value={row.provider || ''} onChange={event => changeRoute(index, { provider: event.target.value })} /></label>
        <label>{language === 'zh-CN' ? '模型 ID' : 'Model ID'}<input value={row.model} onChange={event => changeRoute(index, { model: event.target.value })} /></label>
        <label className="delegation-route-wide">{language === 'zh-CN' ? '自定义模型地址（可代替提供商）' : 'Custom model URL (instead of provider)'}<input type="url" value={row.base_url || ''} onChange={event => changeRoute(index, { base_url: event.target.value })} /></label>
        <label>{language === 'zh-CN' ? 'API 模式' : 'API mode'}<input value={row.api_mode || ''} onChange={event => changeRoute(index, { api_mode: event.target.value })} /></label>
        <label>{language === 'zh-CN' ? '推理强度' : 'Reasoning effort'}<select value={row.reasoning_effort || ''} onChange={event => changeRoute(index, { reasoning_effort: event.target.value })}><option value="">{language === 'zh-CN' ? '继承' : 'Inherit'}</option>{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>{language === 'zh-CN' ? '服务档位' : 'Service tier'}<select value={row.service_tier || ''} onChange={event => changeRoute(index, { service_tier: event.target.value })}><option value="">{language === 'zh-CN' ? '继承' : 'Inherit'}</option>{['normal', 'fast', 'ultrafast'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="delegation-route-secret">{language === 'zh-CN' ? '路由密钥' : 'Route API key'}<input type="password" autoComplete="new-password" value={row.api_key || ''} onChange={event => changeRoute(index, { api_key: event.target.value })} /><small>{language === 'zh-CN' ? '已有密钥仅显示遮盖值；不修改则保留。' : 'Existing keys are masked and preserved unless changed.'}</small></label>
        <div className="delegation-route-advanced">
          <strong>{language === 'zh-CN' ? '该路由的回退链' : 'Fallbacks for this route'}</strong>
          {fallbacks.map((fallback, fallbackIndex) => <div className="delegation-route-fallback" key={fallbackIndex}>
            <input aria-label={`${row.name || index + 1} ${language === 'zh-CN' ? '回退提供商' : 'fallback provider'} ${fallbackIndex + 1}`} placeholder={language === 'zh-CN' ? '提供商' : 'Provider'} value={fallback.provider} onChange={event => changeRoute(index, { fallback_providers: fallbacks.map((item, i) => i === fallbackIndex ? { ...item, provider: event.target.value } : item) })} />
            <input aria-label={`${row.name || index + 1} ${language === 'zh-CN' ? '回退模型' : 'fallback model'} ${fallbackIndex + 1}`} placeholder={language === 'zh-CN' ? '模型 ID' : 'Model ID'} value={fallback.model} onChange={event => changeRoute(index, { fallback_providers: fallbacks.map((item, i) => i === fallbackIndex ? { ...item, model: event.target.value } : item) })} />
            <button type="button" onClick={() => changeRoute(index, { fallback_providers: fallbacks.filter((_, i) => i !== fallbackIndex) })}>{language === 'zh-CN' ? '移除' : 'Remove'}</button>
          </div>)}
          <button type="button" onClick={() => changeRoute(index, { fallback_providers: [...fallbacks, { provider: '', model: '' }] })}>{language === 'zh-CN' ? '添加回退模型' : 'Add fallback'}</button>
        </div>
        <label className="delegation-route-overrides">{language === 'zh-CN' ? '请求覆盖参数（JSON 对象）' : 'Request overrides (JSON object)'}
          <textarea spellCheck={false} value={overrideDrafts[index] ?? JSON.stringify(row.request_overrides ?? {}, null, 2)} onChange={event => { setOverrideDrafts(current => ({ ...current, [index]: event.target.value })); setDirty(true) }} />
        </label>
        <button type="button" onClick={() => changeRoute(index, { api_key: '' })}>{language === 'zh-CN' ? '清除密钥' : 'Clear key'}</button>
        <button type="button" onClick={() => {
          update({ ...routing, model_map: { default: routing.model_map.default === row.name ? null : routing.model_map.default, options: routing.model_map.options.filter((_, i) => i !== index) } })
          setOverrideDrafts(current => Object.fromEntries(Object.entries(current).flatMap(([key, value]) => {
            const position = Number(key)
            return position === index ? [] : [[position > index ? position - 1 : position, value]]
          })))
        }}>{language === 'zh-CN' ? '移除路由' : 'Remove route'}</button>
      </div>
      })}
      <label>{language === 'zh-CN' ? '默认路由' : 'Default route'} <select value={routing.model_map.default || ''} onChange={event => update({ ...routing, model_map: { ...routing.model_map, default: event.target.value || null } })}><option value="">{language === 'zh-CN' ? '继承主模型' : 'Inherit main model'}</option>{routing.model_map.options.filter(row => row.name).map(row => <option key={row.name} value={row.name}>{row.name}</option>)}</select></label>
      <button type="button" onClick={() => update({ ...routing, model_map: { ...routing.model_map, options: [...routing.model_map.options, { name: '', description: '', provider: '', model: '' }] } })}>{language === 'zh-CN' ? '添加模型路由' : 'Add model route'}</button>
    </div>}
    {routing.configured === 'profile_routes' && <div className="delegation-routes">
      <h3>{language === 'zh-CN' ? 'Profile 路由' : 'Profile routes'}</h3>
      {routing.profiles.map(name => <label key={name}><input type="checkbox" checked={routing.profile_routes.profiles.some(row => row.name === name)} onChange={event => update({ ...routing, profile_routes: { ...routing.profile_routes, profiles: event.target.checked ? [...routing.profile_routes.profiles, { name }] : routing.profile_routes.profiles.filter(row => row.name !== name), default: !event.target.checked && routing.profile_routes.default === name ? null : routing.profile_routes.default } })} />{name}</label>)}
      {routing.profile_routes.profiles.map(row => <label key={row.name}>{row.name}<input aria-label={`${row.name} 描述`} value={row.description || ''} onChange={event => update({ ...routing, profile_routes: { ...routing.profile_routes, profiles: routing.profile_routes.profiles.map(item => item.name === row.name ? { ...item, description: event.target.value } : item) } })} /></label>)}
      <label>{language === 'zh-CN' ? '默认 Profile' : 'Default Profile'}<select value={routing.profile_routes.default || ''} onChange={event => update({ ...routing, profile_routes: { ...routing.profile_routes, default: event.target.value || null } })}><option value="">{language === 'zh-CN' ? '未指定' : 'None'}</option>{routing.profile_routes.profiles.map(row => <option key={row.name} value={row.name}>{row.name}</option>)}</select></label>
    </div>}
    {dirty && <div className="actions"><button type="button" disabled={busy} onClick={() => void save()}>{language === 'zh-CN' ? '保存路由' : 'Save routes'}</button><button type="button" disabled={busy} onClick={() => void reload()}>{language === 'zh-CN' ? '放弃修改' : 'Discard changes'}</button></div>}
    <p role="status">{status}</p>
  </section>
}
