import React from 'react'
import type { LocalSkill } from './model'
import type { labels } from './labels'

type T = ReturnType<typeof labels>
type Props = {
  skills: LocalSkill[]; busy: boolean; t: T;
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  run: (operation: string, payload?: Record<string, unknown>, after?: 'skills') => Promise<boolean>
  onError: (message: string) => void
}

export default function LocalSkills({ skills, busy, t, request, run, onError }: Props) {
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<LocalSkill | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [name, setName] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [content, setContent] = React.useState('')
  const visible = skills.filter(skill => `${skill.name} ${skill.description || ''}`.toLowerCase().includes(query.toLowerCase()))

  async function open(skill: LocalSkill) {
    setSelected(skill)
    setCreating(false)
    setEditing(false)
    try {
      const value = await request<{ content: string }>('skills.content', { name: skill.name })
      setContent(value.content)
    } catch { onError(t('failed')) }
  }

  function newSkill() {
    setSelected(null); setCreating(true); setEditing(true); setName(''); setCategory('')
    setContent('---\nname: \ndescription: \n---\n\n# Skill\n')
  }

  async function save() {
    const success = await run(creating ? 'skills.create' : 'skills.edit', creating
      ? { name: name.trim(), category: category.trim(), content }
      : { name: selected?.name, content }, 'skills')
    if (success) { setCreating(false); setEditing(false); setSelected(null) }
  }

  return <>
    <div className="row extension-toolbar">
      <input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
      {skills.some(skill => skill.provenance === 'hub') && <button disabled={busy} onClick={() => void run('skills.update', {}, 'skills')}>{t('update')}</button>}
      <button disabled={busy} onClick={newSkill}>{t('create')}</button>
    </div>
    {!visible.length && <p>{t('empty')}</p>}
    <div className="extension-list">{visible.map(skill =>
      <article className="extension-card" key={skill.name}>
        <div className="row"><strong>{skill.name}</strong><small>{skill.enabled ? t('enabled') : t('disabled')}</small></div>
        <p>{skill.description}</p>
        <small>{t('source')}: {skill.provenance || 'local'}{skill.category ? ` · ${skill.category}` : ''}</small>
        <div className="extension-actions">
          <button onClick={() => void open(skill)}>{t('detail')}</button>
          <button disabled={busy} onClick={() => void run('skills.toggle', { name: skill.name, enabled: !skill.enabled }, 'skills')}>
            {skill.enabled ? t('disable') : t('enable')}
          </button>
          {(skill.provenance === 'hub' || skill.provenance === 'modelscope') && <button disabled={busy} onClick={() => {
            if (window.confirm(t('uninstallConfirm'))) void run(skill.provenance === 'modelscope' ? 'modelscope.uninstall' : 'skills.uninstall', { name: skill.name }, 'skills')
          }}>{t('uninstall')}</button>}
        </div>
      </article>)}</div>
    {(selected || creating) && <section className="extension-detail">
      <div className="row"><h3>{creating ? t('create') : selected?.name}</h3><button onClick={() => { setSelected(null); setCreating(false); setEditing(false) }}>{t('close')}</button></div>
      {creating && <><label>{t('name')}<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
        <label>{t('category')}<input value={category} maxLength={100} onChange={event => setCategory(event.target.value)} /></label></>}
      <label>{t('content')}<textarea className="extension-editor" value={content} readOnly={!editing} onChange={event => setContent(event.target.value)} /></label>
      <div className="extension-actions">
        {!creating && selected?.provenance !== 'bundled' && selected?.provenance !== 'hub' && selected?.provenance !== 'modelscope' &&
          <button onClick={() => setEditing(true)}>{t('edit')}</button>}
        {editing && <button disabled={busy || (creating && !name.trim()) || !content.trim()} onClick={() => void save()}>{t('save')}</button>}
      </div>
    </section>}
  </>
}
