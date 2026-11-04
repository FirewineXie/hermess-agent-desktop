import React from 'react'
import { describeError } from '../../app/desktopErrors'
import type { LocalSkill } from '../extensions/model'

type Props = {
  skill: LocalSkill | null
  language: 'zh-CN' | 'en-US'
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  onClose: () => void
  onSaved: () => Promise<void>
}

export default function ProfileSkillEditor({ skill, language, request, onClose, onSaved }: Props) {
  const zh = language === 'zh-CN'
  const [name, setName] = React.useState(skill ? '' : 'my-skill')
  const [category, setCategory] = React.useState('')
  const [content, setContent] = React.useState(skill ? '' : '---\nname: my-skill\ndescription: Describe when the agent should use this skill.\n---\n\n# My Skill\n\nAdd concrete instructions here.\n')
  const [loading, setLoading] = React.useState(Boolean(skill))
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!skill) return
    let cancelled = false
    void request<{ content: string }>('skills.content', { name: skill.name }).then(result => {
      if (!cancelled) setContent(result.content)
    }).catch(reason => {
      if (!cancelled) setError(describeError(reason, language))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [skill?.name, request, language])

  async function save() {
    if (saving || loading || !content.trim() || (!skill && !name.trim())) return
    setSaving(true)
    setError('')
    try {
      await request(skill ? 'skills.edit' : 'skills.create', skill
        ? { name: skill.name, content }
        : { name: name.trim(), category: category.trim(), content })
      await onSaved()
      onClose()
    } catch (reason) {
      setError(describeError(reason, language))
    } finally {
      setSaving(false)
    }
  }

  return <section className="profile-skill-editor" aria-label={skill ? (zh ? `编辑技能 ${skill.name}` : `Edit skill ${skill.name}`) : (zh ? '新建技能' : 'New skill')}>
    <div className="profile-skill-editor-heading"><div><h4>{skill ? (zh ? `编辑 ${skill.name}` : `Edit ${skill.name}`) : (zh ? '新建技能' : 'New skill')}</h4><p>{zh ? '编辑 SKILL.md；保存时由 Hermes 验证内容。' : 'Edit SKILL.md. Hermes validates it on save.'}</p></div><button type="button" disabled={saving} onClick={onClose}>{zh ? '关闭' : 'Close'}</button></div>
    {!skill && <div className="profile-skill-editor-fields"><label>{zh ? '技能名称' : 'Skill name'}<input value={name} maxLength={100} onChange={event => { const next = event.target.value; setContent(current => current.replace(`name: ${name}\n`, `name: ${next}\n`)); setName(next) }} placeholder="my-skill" /></label><label>{zh ? '分类（可选）' : 'Category (optional)'}<input value={category} maxLength={100} onChange={event => setCategory(event.target.value)} /></label></div>}
    <label>{'SKILL.md'}{loading ? <p>{zh ? '读取内容中…' : 'Loading content…'}</p> : <textarea spellCheck={false} value={content} onChange={event => setContent(event.target.value)} />}</label>
    {error && <p className="profile-skill-action-error" role="alert">{error}</p>}
    <div className="profile-skill-editor-actions"><button type="button" disabled={saving} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" disabled={saving || loading || !content.trim() || (!skill && !name.trim())} onClick={() => void save()}>{saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存技能' : 'Save skill')}</button></div>
  </section>
}
