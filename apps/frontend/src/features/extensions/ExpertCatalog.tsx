import React from 'react'
import type { ProfileCreateOptions, ProfilesSnapshot } from '@hermess/contracts'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { expertPresets, type ExpertPreset } from './expertPresets'
import { keepFocusInside } from './dialogFocus'

type CreateResult = { name: string; warnings?: string[]; served: boolean } | undefined
type Props = {
  profiles: ProfilesSnapshot | null
  busy: boolean
  onCreate: (name: string, options?: ProfileCreateOptions) => Promise<CreateResult>
}

function availableName(base: string, profiles: ProfilesSnapshot | null) {
  const names = new Set(profiles?.profiles.map(profile => profile.name.toLowerCase()) || [])
  if (!names.has(base)) return base
  for (let index = 2; ; index++) {
    const candidate = `${base.slice(0, 64 - String(index).length - 1)}-${index}`
    if (!names.has(candidate)) return candidate
  }
}

export default function ExpertCatalog({ profiles, busy, onCreate }: Props) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [chosen, setChosen] = React.useState<ExpertPreset | null>(null)
  const [name, setName] = React.useState('')
  const [skills, setSkills] = React.useState<string[]>([])
  const [mcp, setMcp] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const nameRef = React.useRef<HTMLInputElement>(null)
  const openerRef = React.useRef<HTMLButtonElement | null>(null)
  React.useEffect(() => {
    if (!chosen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    nameRef.current?.focus()
    return () => { document.body.style.overflow = previous }
  }, [chosen])

  function open(preset: ExpertPreset, button: HTMLButtonElement) {
    openerRef.current = button
    setChosen(preset)
    setName(availableName(preset.id, profiles))
    setSkills([...preset.skills])
    setMcp([...preset.mcp])
    setError('')
    setNotice('')
  }

  function close() {
    if (submitting) return
    setChosen(null)
    setError('')
    requestAnimationFrame(() => openerRef.current?.focus())
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!chosen || submitting || busy) return
    const normalized = name.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
      setError(zh ? '名称须以字母或数字开头，仅含小写字母、数字、-、_，最多 64 个字符。' : 'Use up to 64 lowercase letters, numbers, hyphens or underscores, starting with a letter or number.')
      return
    }
    if (profiles?.profiles.some(profile => profile.name.toLowerCase() === normalized)) {
      setError(zh ? '此专家名称已存在，请换一个名称。' : 'An expert with this name already exists.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const preset = {
        personalityName: chosen.personality.name,
        personalityPrompt: chosen.personality.prompt,
        skills,
        mcp,
      }
      const result = await onCreate(normalized, { preset })
      if (!result) return
      setChosen(null)
      setNotice(result.served
        ? (result.warnings?.length ? (zh ? '专家已创建，但部分预设配置未完成；请查看侧栏提示。' : 'Expert created, but some preset settings need attention; see the sidebar.') : (zh ? '专家已创建，可在侧栏打开。' : 'Expert created. Open it from the sidebar.'))
        : (zh ? '专家已创建，等待 Gateway 启用；可在侧栏重试。' : 'Expert created and waiting for the Gateway. Retry from the sidebar.'))
      requestAnimationFrame(() => openerRef.current?.focus())
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setSubmitting(false)
    }
  }

  return <section className="expert-catalog" aria-label={zh ? '专家预设市场' : 'Expert preset market'}>
    <div className="expert-catalog-heading"><div><h2>{zh ? '专家预设' : 'Expert presets'}</h2><p>{zh ? '从市场选择预设并安装为独立 Profile；安装后的配置在 Profile 管理页维护。' : 'Install a market preset as a separate profile. Manage it from the Profiles page afterward.'}</p></div></div>
    {notice && <p className="expert-catalog-notice" role="status">{notice}</p>}
    <div className="capability-experts">
      {expertPresets.map(preset => <article className="capability-expert-card" key={preset.id}>
        <span className="expert-card-source">{zh ? 'Hermess 内置' : 'Built into Hermess'}</span>
        <h3>{preset.title[language]}</h3>
        <p>{preset.description[language]}</p>
        <small>{zh ? 'Skill：' : 'Skill: '}{preset.skills.length ? preset.skills.join(zh ? '、' : ', ') : (zh ? '无额外 Skill' : 'No extra skills')}</small>
        <small>{zh ? 'MCP：' : 'MCP: '}{preset.mcp.length ? preset.mcp.join(zh ? '、' : ', ') : (zh ? '无' : 'None')}</small>
        <button type="button" disabled={busy || submitting} onClick={event => open(preset, event.currentTarget)}>{zh ? '安装预设' : 'Install preset'}</button>
      </article>)}
    </div>
    {chosen && <div className="expert-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <form className="expert-create-modal" role="dialog" aria-modal="true" aria-labelledby="expert-create-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } else keepFocusInside(event) }} onSubmit={event => void create(event)}>
        <header><div><h2 id="expert-create-title">{zh ? `安装 ${chosen.title[language]}` : `Install ${chosen.title[language]}`}</h2><p>{zh ? '市场预设将安装为一个独立的 Profile。' : 'The market preset is installed as a separate profile.'}</p></div><button type="button" className="expert-modal-close" aria-label={zh ? '关闭' : 'Close'} disabled={submitting} onClick={close}>×</button></header>
        <div className="expert-modal-body">
          <label className="expert-name-field">{zh ? 'Profile 名称' : 'Profile name'}<input ref={nameRef} required maxLength={64} spellCheck={false} autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder="my-expert" /></label>
          <p className="expert-name-hint">{zh ? '名称用于本地标识，只能使用字母、数字、-、_。' : 'The local identifier uses letters, numbers, hyphens and underscores.'}</p>
          <>
            <section className="expert-recipe-summary"><h3>{zh ? '预设人格' : 'Preset personality'}</h3><p>{chosen.description[language]}</p></section>
            {!!chosen.skills.length && <fieldset><legend>Skill</legend>{chosen.skills.map(skill => <label key={skill}><input type="checkbox" checked={skills.includes(skill)} onChange={event => setSkills(current => event.target.checked ? [...current, skill] : current.filter(item => item !== skill))} />{skill}</label>)}</fieldset>}
            {!!chosen.mcp.length && <fieldset><legend>MCP</legend>{chosen.mcp.map(server => <label key={server}><input type="checkbox" checked={mcp.includes(server)} onChange={event => setMcp(current => event.target.checked ? [...current, server] : current.filter(item => item !== server))} />{server}</label>)}<p>{zh ? '创建时写入配置；创建后可在 MCP 管理中测试连接。' : 'Configuration is written during creation. Test the connection in MCP management afterward.'}</p></fieldset>}
          </>
          {error && <p className="expert-create-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" disabled={submitting} onClick={close}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={submitting || busy || !name.trim()}>{submitting ? (zh ? '正在创建…' : 'Creating…') : (zh ? '创建专家' : 'Create expert')}</button></footer>
      </form>
    </div>}
  </section>
}
