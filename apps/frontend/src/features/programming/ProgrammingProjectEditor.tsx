import React from 'react'
import { createPortal } from 'react-dom'
import type { CodingProject } from '@hermess/contracts'
import type { Language } from '../../i18n'
import { describeError } from '../../app/desktopErrors'
import type { ProgrammingController } from './useProgrammingController'

export default function ProgrammingProjectEditor({ project, controller, language, onClose, onCreated }: {
  project: CodingProject | null; controller: ProgrammingController; language: Language; onClose: () => void; onCreated: (project: CodingProject) => void
}) {
  const zh = language === 'zh-CN'
  const [name, setName] = React.useState(project?.name || '')
  const [directory, setDirectory] = React.useState(project?.cwd || '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const pending = React.useRef(false)
  const form = React.useRef<HTMLFormElement>(null)
  React.useEffect(() => {
    const previous = document.activeElement
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await action() } catch (cause) { setError(describeError(cause, language)) }
    finally { pending.current = false; setBusy(false) }
  }
  return createPortal(<div className="programming-project-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form ref={form} className="programming-project-dialog" role="dialog" aria-modal="true" aria-labelledby="programming-project-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key === 'Tab') {
        const elements = form.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
        if (!elements?.length) return
        const first = elements[0], last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }} onSubmit={event => {
      event.preventDefault(); void perform(async () => {
        const saved = await controller.saveProject(project?.id || null, name, directory)
        if (!project) onCreated(saved)
        onClose()
      })
    }}>
      <header><h2 id="programming-project-title">{project ? (zh ? '编辑项目' : 'Edit project') : (zh ? '添加编程项目' : 'Add programming project')}</h2><button type="button" disabled={busy} aria-label={zh ? '关闭' : 'Close'} onClick={onClose}>×</button></header>
      <label>{zh ? '项目名称' : 'Project name'}<input autoFocus value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} placeholder={zh ? '例如：我的网站' : 'For example: My website'} required /></label>
      <label>{zh ? '项目地址' : 'Project directory'}<span className="programming-directory-input"><input value={directory} disabled={busy} onChange={event => setDirectory(event.target.value)} placeholder={zh ? '本机项目目录的完整路径' : 'Absolute local project path'} required /><button type="button" disabled={busy} onClick={() => void perform(async () => {
        const chosen = await controller.nativeFiles.choose({ directory: true, multiple: false, title: zh ? '选择项目目录' : 'Choose project directory' })
        if (typeof chosen === 'string') { setDirectory(chosen); if (!name.trim()) setName(chosen.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || chosen) }
      })}>{zh ? '浏览' : 'Browse'}</button></span></label>
      <p>{zh ? '新会话使用这里的目录。已有会话保留原来的工作目录和上下文。' : 'New chats use this directory. Existing chats retain their original directory and context.'}</p>
      {error && <p className="programming-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className="programming-primary" disabled={busy || !name.trim() || !directory.trim()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存项目' : 'Save project')}</button></footer>
    </form>
  </div>, document.body)
}
