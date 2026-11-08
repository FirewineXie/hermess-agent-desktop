import React from 'react'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import { projectKey } from './programmingProjects'
import ProgrammingBranch from './ProgrammingBranch'

export function ProgrammingWorkspace({ language, controller }: { language: Language; controller: ProgrammingController }) {
  const zh = language === 'zh-CN'
  const { session, cwd, projects, draftProjectId } = controller
  const directory = session?.cwd || cwd
  const project = projects.find(project => session?.project_id ? project.id === session.project_id
    : !session && draftProjectId ? project.id === draftProjectId
      : project.legacy_cwds.some(path => projectKey(path) === projectKey(directory)))
  const name = project?.name || directory.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || directory
  return <div className="programming-workspace" aria-label={zh ? '编程工作空间' : 'Programming workspace'}>
    <span title={directory || undefined}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5h6l2 2h10v12H3Z" /></svg><span>{name || (zh ? '未选择项目' : 'No project selected')}</span></span>
    <span title={directory || undefined}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H4ZM2 20h20" /></svg>{zh ? '本地工作空间' : 'Local workspace'}</span>
    {directory && <ProgrammingBranch key={directory} directory={directory} controller={controller} language={language} />}
  </div>
}

export function ProgrammingUsage({ language, controller }: { language: Language; controller: ProgrammingController }) {
  const zh = language === 'zh-CN'
  const context = controller.session?.context
  const used = context?.used_tokens
  const window = context?.context_window
  const percent = used !== undefined && window ? Math.round(used / window * 100) : null
  const format = (value: number) => value.toLocaleString(zh ? 'zh-CN' : 'en-US')
  return <details className="programming-usage" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
    <summary aria-label={zh ? '模型上下文用量' : 'Model context usage'} title={zh ? '查看模型上下文用量' : 'View model context usage'}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle className="usage-track" cx="12" cy="12" r="9" /><circle className="usage-value" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${Math.min(percent ?? 0, 100)} 100`} /></svg>
      <span>{percent === null ? (zh ? '上下文' : 'Context') : `${percent}%`}</span>
    </summary>
    <div className="programming-usage-popover" role="status">
      <strong>{zh ? '模型上下文' : 'Model context'}</strong>
      <p>{used === undefined ? (zh ? '等待运行时返回用量' : 'Waiting for runtime usage') : `${zh ? '最近一次请求' : 'Latest request'}：${format(used)} tokens`}</p>
      <p>{window ? `${zh ? '上下文容量' : 'Context window'}：${format(window)} tokens` : (zh ? '运行时尚未返回上下文容量' : 'Context window not reported by runtime')}</p>
      {percent !== null && <progress max={100} value={Math.min(percent, 100)} aria-label={zh ? '上下文使用比例' : 'Context usage ratio'} />}
      <small>{zh ? '来自运行时最近一次请求的统计，压缩后会更新。' : 'Runtime accounting for the latest request; updates after compaction.'}</small>
    </div>
  </details>
}
