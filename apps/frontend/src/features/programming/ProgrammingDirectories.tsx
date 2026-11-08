import React from 'react'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import { programmingProjects } from './programmingProjects'
import ProgrammingProjectEditor from './ProgrammingProjectEditor'
import './programmingDirectories.css'

function FolderIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2Z" /><path d="M3 10h18" /></svg>
}

export default function ProgrammingDirectories({ controller, language }: {
  controller: ProgrammingController; language: Language
}) {
  const zh = language === 'zh-CN'
  const [adding, setAdding] = React.useState(false)
  const directories = programmingProjects(controller.sessions, controller.cwd, controller.projects)
  return <section className="chat-panel programming-directories" aria-label={zh ? 'Code 工作目录' : 'Code working directories'}>
    <div className="programming-directories-content">
      <header className="programming-directories-heading">
        <div><h1>{zh ? '选择工作目录' : 'Choose a working directory'}</h1>
          <p>{zh ? '在项目目录中开始编程，或从左侧继续已有会话。' : 'Start coding in a project directory, or continue a chat from the sidebar.'}</p></div>
        <button type="button" className="programming-directory-add" disabled={controller.busy} onClick={() => setAdding(true)}><span aria-hidden="true">＋</span>{zh ? '添加工作目录' : 'Add directory'}</button>
      </header>
      <div className="programming-directories-list">
        {directories.map(directory => <button key={directory.key} type="button" className="programming-directory-row" disabled={controller.busy} onClick={() => {
          const projectId = controller.projects.find(project => project.id === directory.key)?.id
          if (controller.newSession(directory.cwd, projectId)) console.info('[programming] directory selected', { registered: Boolean(projectId) })
        }}>
          <span className="programming-directory-icon"><FolderIcon /></span>
          <span className="programming-directory-copy"><strong title={directory.name}>{directory.name}</strong><small title={directory.cwd}>{directory.cwd}</small></span>
          <svg className="programming-directory-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
        </button>)}
      </div>
      {!directories.length && <div className="programming-directories-empty"><FolderIcon /><h2>{zh ? '还没有工作目录' : 'No working directories yet'}</h2><p>{zh ? '添加一个本地项目，开始你的第一个编程会话。' : 'Add a local project to start your first coding chat.'}</p></div>}
      {controller.error && <p className="programming-directories-error" role="alert">{controller.error}</p>}
    </div>
    {adding && <ProgrammingProjectEditor project={null} controller={controller} language={language} onClose={() => setAdding(false)} onCreated={project => { controller.newSession(project.cwd, project.id) }} />}
  </section>
}
