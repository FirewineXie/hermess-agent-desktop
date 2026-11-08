import React from 'react'
import type { CodingProject } from '@hermess/contracts'
import ProgrammingProjectEditor from './ProgrammingProjectEditor'
import ProgrammingProjectInfo from './ProgrammingProjectInfo'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import { programmingProjects, projectKey } from './programmingProjects'
import './programming.css'
import '../../app/sidebar-session-actions.css'

export default function ProgrammingSessions({ controller, language, active, onOpen }: {
  controller: ProgrammingController; language: Language; active: boolean; onOpen: (id?: string, directory?: string, projectId?: string) => void
}) {
  const zh = language === 'zh-CN'
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [visible, setVisible] = React.useState<Record<string, number>>({})
  const [editor, setEditor] = React.useState<CodingProject | null | undefined>()
  const [info, setInfo] = React.useState<{ id: string; left: number; top: number } | null>(null)
  const { sessions, session, cwd, projects: registry, draftProjectId, busy, error } = controller
  const projects = programmingProjects(sessions, active && !session ? cwd : '', registry)
  const currentProject = session?.project_id || (!session && draftProjectId) || registry.find(project => project.legacy_cwds.some(path => projectKey(path) === projectKey(session?.cwd || cwd)))?.id || projectKey(session?.cwd || cwd)
  React.useEffect(() => {
    if (active) setExpanded(current => ({ ...current, [currentProject]: true }))
  }, [active, currentProject, session?.id])
  const status = { idle: '', running: zh ? '正在运行' : 'Running', completed: '', stopped: zh ? '已停止' : 'Stopped', failed: zh ? '失败' : 'Failed' }
  const start = (directory?: string, projectId?: string) => {
    if (directory) setExpanded(current => ({ ...current, [projectId || projectKey(directory)]: true }))
    onOpen(undefined, directory, projectId)
  }
  const remove = (id: string, title: string) => {
    if (window.confirm(zh ? `删除编程会话「${title}」？会话历史和运行数据将被永久删除，项目文件保留。` : `Delete programming chat “${title}”? Chat history and runtime data will be permanently deleted. Project files are retained.`)) void controller.remove(id)
  }
  return <section className="programming-session-list" aria-label={zh ? '编程会话' : 'Programming chats'}>
    <div className="sidebar-section-heading"><strong>{zh ? '编程会话' : 'PROGRAMMING CHATS'}</strong>
      <button type="button" className="sidebar-profile-manage" disabled={busy} aria-label={zh ? '添加编程项目' : 'Add programming project'} title={zh ? '添加编程项目' : 'Add programming project'} onClick={() => setEditor(null)}>＋</button>
    </div>
    {!projects.length && <button type="button" className="sidebar-profile-session" disabled={busy} onClick={() => setEditor(null)}><span className="session-title">{zh ? '添加项目' : 'Add project'}</span></button>}
    {projects.map((project, index) => {
      const open = expanded[project.key] ?? index === 0
      const count = visible[project.key] || 5
      const registered = registry.find(row => row.id === project.key)
      return <div className="programming-project" key={project.key}>
        <div className="sidebar-profile-heading">
          <button type="button" className="sidebar-profile-row" title={project.cwd} aria-expanded={open} onClick={() => setExpanded(current => ({ ...current, [project.key]: !open }))}>
            <svg className="programming-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 3h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V7Zm0 3h18" /></svg>
            <span className="session-title">{project.name}</span><span className="sidebar-profile-chevron" aria-hidden="true">⌄</span>
          </button>
          {registered && <button type="button" className="sidebar-profile-manage programming-project-menu" aria-label={zh ? `项目详情 ${project.name}` : `Project details ${project.name}`} aria-expanded={info?.id === registered.id} title={zh ? '项目详情与编辑' : 'Project details and editing'} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            setInfo({ id: registered.id, left: Math.max(12, Math.min(rect.right + 8, window.innerWidth - 372)), top: Math.max(12, Math.min(rect.top, window.innerHeight - 260)) })
          }}>···</button>}
          <button type="button" className="sidebar-profile-manage" disabled={busy} aria-label={zh ? `在 ${project.name} 新建编程会话` : `New programming chat in ${project.name}`} title={zh ? '在此项目新建会话' : 'New chat in this project'} onClick={() => start(project.cwd, registered?.id)}>＋</button>
        </div>
        {open && <div className="programming-project-chats">
          {active && !session && controller.draftVisible && currentProject === project.key && <div className="programming-session-entry"><button type="button" className="sidebar-profile-session active" disabled={busy} onClick={() => start(project.cwd, registered?.id)}><span className="session-title">{zh ? '新编程会话' : 'New programming chat'}</span></button><button type="button" className="sidebar-session-archive programming-session-archive" disabled aria-label={zh ? '归档新编程会话草稿' : 'Archive new programming chat draft'} title={zh ? '发送第一条消息后才能归档' : 'Send the first message before archiving'}>□</button><button type="button" className="sidebar-session-delete programming-session-delete" disabled={busy} aria-label={zh ? '删除新编程会话草稿' : 'Delete new programming chat draft'} title={zh ? '删除草稿' : 'Delete draft'} onClick={() => { if ((!controller.draft.trim() && !controller.images.length && !controller.files.length) || window.confirm(zh ? '删除新编程会话草稿和附件？' : 'Delete the new programming chat draft and attachments?')) controller.discardDraft() }}>×</button></div>}
          {project.sessions.slice(0, count).map(row => <div className="programming-session-entry" key={row.id}><button type="button" disabled={busy} title={row.title} className={`sidebar-profile-session ${active && session?.id === row.id ? 'active' : ''}`} onClick={() => onOpen(row.id)}>
            <span className="session-title">{row.title}</span>{status[row.status] && <span className="programming-session-state" role="status" aria-label={status[row.status]} title={status[row.status]}>{row.status === 'running' ? <span className="programming-session-spinner" aria-hidden="true" /> : status[row.status]}</span>}
          </button><button type="button" className="sidebar-session-archive programming-session-archive" disabled={busy || row.status === 'running'} aria-label={zh ? `归档编程会话 ${row.title}` : `Archive programming chat ${row.title}`} title={row.status === 'running' ? (zh ? '请先停止运行中的会话' : 'Stop the running chat first') : (zh ? '归档会话' : 'Archive chat')} onClick={() => void controller.archive(row.id, true)}>□</button><button type="button" className="sidebar-session-delete programming-session-delete" disabled={busy || row.status === 'running'} aria-label={zh ? `删除编程会话 ${row.title}` : `Delete programming chat ${row.title}`} title={row.status === 'running' ? (zh ? '请先停止运行中的会话' : 'Stop the running chat first') : (zh ? '删除会话' : 'Delete chat')} onClick={() => remove(row.id, row.title)}>×</button></div>)}
          {project.sessions.length > 5 && <button type="button" className="sidebar-profile-session programming-project-more" onClick={() => setVisible(current => ({ ...current, [project.key]: count >= project.sessions.length ? 5 : count + 5 }))}>{count >= project.sessions.length ? (zh ? '收起' : 'Show less') : (zh ? '展开显示' : 'Show more')}</button>}
        </div>}
      </div>
    })}
    {info && registry.find(project => project.id === info.id) && <ProgrammingProjectInfo project={registry.find(project => project.id === info.id)!} total={projects.find(project => project.key === info.id)?.sessions.length || 0} running={projects.find(project => project.key === info.id)?.sessions.filter(row => row.status === 'running').length || 0} position={info} language={language} onClose={() => setInfo(null)} onEdit={() => { setEditor(registry.find(project => project.id === info.id)); setInfo(null) }} />}
    {editor !== undefined && <ProgrammingProjectEditor project={editor} controller={controller} language={language} onClose={() => setEditor(undefined)} onCreated={project => start(project.cwd, project.id)} />}
    {error && !active && <p role="alert">{error}</p>}
  </section>
}
