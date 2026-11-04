import React from 'react'
import type { ProfileRow } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type Field = { name: string; type: 'time' | 'enum' | 'text' | 'weekdays'; label: string
  default: string | null; options: string[]; optional: boolean; strict?: boolean; help: string }
type Blueprint = { key: string; title: string; description: string; category: string
  tags: string[]; fields: Field[]; source?: 'builtin' | 'plugin'; plugin?: string | null }

const defaults = (blueprint: Blueprint) => Object.fromEntries(blueprint.fields.map(field => [field.name, field.default || '']))

function BlueprintCard({ blueprint, profile, onCreated }: { blueprint: Blueprint; profile: string; onCreated: (partial: boolean) => void }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<Record<string, string>>(() => defaults(blueprint))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const missing = blueprint.fields.find(field => !field.optional && !values[field.name]?.trim())
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || missing) return
    setBusy(true); setError('')
    try {
      const result = await extensions.request<{ id?: string; job_saved?: boolean; scheduler_registered?: boolean }>(
        { kind: 'profile', profile }, 'jobs.blueprints.instantiate', { profile, blueprint: blueprint.key, values })
      setOpen(false); setValues(defaults(blueprint))
      onCreated(result.job_saved === true && result.scheduler_registered === false)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  return <article className="scheduled-blueprint-card">
    <div className="scheduled-blueprint-heading"><div className="scheduled-blueprint-copy"><span className="scheduled-blueprint-category">{blueprint.category || (zh ? '自动化蓝图' : 'Automation')}</span><h3>{blueprint.title}</h3><p>{blueprint.description}</p>
      <div className="scheduled-blueprint-tags">{blueprint.plugin && <span>{blueprint.plugin}</span>}{blueprint.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div>
      <button className="scheduled-blueprint-action" type="button" aria-expanded={open} onClick={() => { setOpen(!open); setError('') }}>{open ? (zh ? '收起配置' : 'Close setup') : (zh ? '使用蓝图' : 'Use blueprint')}</button></div>
    {open && <form className="scheduled-blueprint-form" onSubmit={event => void submit(event)}>
      {blueprint.fields.map(field => <label key={field.name}>{field.label}{field.optional && <small>{zh ? '可选' : 'Optional'}</small>}
        {(field.type === 'enum' || field.type === 'weekdays') && field.strict !== false
          ? <select value={values[field.name] || ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}>
              {field.optional && <option value="">—</option>}{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
          : <input type={field.type === 'time' ? 'time' : 'text'} list={field.strict === false ? `blueprint-${blueprint.key}-${field.name}` : undefined}
              maxLength={4096} value={values[field.name] || ''} placeholder={field.help || field.label}
              onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} />}
        {field.strict === false && <datalist id={`blueprint-${blueprint.key}-${field.name}`}>{field.options.map(option => <option key={option} value={option} />)}</datalist>}
        {field.help && <small>{field.help}</small>}</label>)}
      {error && <p role="alert" className="scheduled-error">{error}</p>}
      <button type="submit" className="design-primary-button" disabled={busy || Boolean(missing)}>{busy ? (zh ? '创建中…' : 'Creating…') : (zh ? '创建计划任务' : 'Schedule task')}</button>
    </form>}
  </article>
}

export default function ScheduledBlueprints({ available, selected, onCreated }: { available: ProfileRow[]; selected: string; onCreated: (partial: boolean) => void }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [profile, setProfile] = React.useState(selected)
  const [blueprints, setBlueprints] = React.useState<Blueprint[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => { if (!available.some(item => item.name === profile)) setProfile(selected) }, [available, profile, selected])
  React.useEffect(() => {
    if (!profile) return
    let active = true
    setLoading(true); setError(''); setBlueprints([])
    void extensions.request<{ blueprints: Blueprint[] }>({ kind: 'profile', profile }, 'jobs.blueprints', { profile })
      .then(result => { if (active) setBlueprints(result.blueprints) })
      .catch(cause => { if (active) setError(describeError(cause, language)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [extensions, profile, revision, language])
  return <div className="scheduled-blueprints">
    <div className="scheduled-blueprints-toolbar"><div><span className="scheduled-section-kicker">{zh ? '快速创建' : 'Quick start'}</span><h3>{zh ? '自动化蓝图' : 'Automation blueprints'}</h3><p>{zh ? '选择一个预设方案，补充少量参数即可创建定时任务。' : 'Choose a preset and provide a few details to create a scheduled task.'}</p></div><div className="scheduled-blueprints-controls"><label>{zh ? '所属 Profile' : 'Profile'}<select value={profile} onChange={event => setProfile(event.target.value)}>{available.map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>{zh ? '刷新蓝图' : 'Refresh blueprints'}</button></div></div>
    {loading && <p role="status">{zh ? '读取蓝图中…' : 'Loading blueprints…'}</p>}
    {error && <p role="alert" className="scheduled-error">{zh ? '蓝图读取失败：' : 'Could not load blueprints: '}{error}</p>}
    {error && <button type="button" onClick={() => setRevision(value => value + 1)}>{zh ? '重试' : 'Retry'}</button>}
    {!loading && !error && !blueprints.length && <p className="scheduled-empty">{zh ? '当前 Profile 没有可用蓝图。' : 'No blueprints are available for this Profile.'}</p>}
    <div className="scheduled-blueprint-grid">{blueprints.map(blueprint => <BlueprintCard key={`${profile}:${blueprint.key}`} blueprint={blueprint} profile={profile} onCreated={onCreated} />)}</div>
  </div>
}
