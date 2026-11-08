import React from 'react'
import { createPortal } from 'react-dom'
import type { CodingProject } from '@hermess/contracts'
import type { Language } from '../../i18n'

export default function ProgrammingProjectInfo({ project, total, running, position, language, onClose, onEdit }: {
  project: CodingProject; total: number; running: number; position: { left: number; top: number }; language: Language; onClose: () => void; onEdit: () => void
}) {
  const zh = language === 'zh-CN'
  const panel = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const pointer = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node)) onClose() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', pointer); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', pointer); document.removeEventListener('keydown', key) }
  }, [onClose])
  return createPortal(<div ref={panel} className="programming-project-info" role="dialog" aria-label={project.name} style={position}>
    <strong>{project.name}</strong>
    <p>{zh ? `${total} 个会话 · ${running} 个正在运行` : `${total} chats · ${running} running`}</p>
    <div className="programming-project-address"><small>{zh ? '项目地址' : 'Project directory'}</small><span>{project.cwd}</span></div>
    <button type="button" onClick={onEdit}>⚙ {zh ? '编辑项目' : 'Edit project'}</button>
  </div>, document.body)
}
