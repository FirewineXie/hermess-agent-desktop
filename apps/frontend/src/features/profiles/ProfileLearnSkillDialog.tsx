import React from 'react'
import { keepFocusInside } from '../extensions/dialogFocus'
import { composeLearnSkillCommand } from './learnSkillModel'

type Props = { language: 'zh-CN' | 'en-US'; onClose(): void; onLearn(command: string): void }

export default function ProfileLearnSkillDialog({ language, onClose, onLearn }: Props) {
  const zh = language === 'zh-CN'
  const [directory, setDirectory] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const command = composeLearnSkillCommand({ directory, url, notes })
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (command) onLearn(command)
  }
  return <div className="profile-delete-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <form className="profile-delete-dialog profile-learn-skill-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-learn-skill-title"
      onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') onClose(); else keepFocusInside(event) }}>
      <h2 id="profile-learn-skill-title">{zh ? '学习一个技能' : 'Learn a skill'}</h2>
      <p>{zh ? '提供任意来源，Hermes 会在新会话中通过现有 /learn 命令读取材料并整理为可复用 Skill。' : 'Point Hermes at any source. A new chat will use the existing /learn command to gather it and author a reusable Skill.'}</p>
      <label>{zh ? '本地文件或目录' : 'Local file or directory'}<input autoFocus value={directory} onChange={event => setDirectory(event.target.value)} placeholder="C:\projects\some-sdk" /></label>
      <label>{zh ? '网址' : 'URL'}<input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://docs.example.com/api" /></label>
      <label>{zh ? '补充说明、工作流或刚才完成的事情' : 'Notes, workflow, or what we just did'}<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder={zh ? '例如：整理刚才的报销流程…' : 'For example: turn the expense workflow we just used into a Skill…'} /></label>
      <div className="profile-delete-actions"><button type="button" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={!command}>{zh ? '在新会话中学习' : 'Learn in a new chat'}</button></div>
    </form>
  </div>
}
