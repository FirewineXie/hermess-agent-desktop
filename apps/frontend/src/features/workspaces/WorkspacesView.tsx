import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'

type Props = {
  connected: boolean
  busy: boolean
  profile: string | null
  agents: Array<{ name: string; label: string }>
  paths: string[]
  selected: string
  selectedForAgent: (profile: string) => string
  onAdd: (path: string) => void
  onSelect: (path: string) => void
  onAssignAgent: (profile: string, path: string) => void
  onRemove: (path: string) => void
  onNewChat: (path: string) => void
}

type AgentMenuProps = {
  title: string
  path: string
  agents: Props['agents']
  selectedForAgent: Props['selectedForAgent']
  onAssignAgent: Props['onAssignAgent']
  onRemove: Props['onRemove']
  zh: boolean
}

function WorkspaceAgentMenu({ title, path, agents, selectedForAgent, onAssignAgent, onRemove, zh }: AgentMenuProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className="workspace-row-menu" ref={rootRef}>
    <button ref={triggerRef} type="button" className="workspace-menu-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-label={zh ? `${title} 的 Agent 分配` : `Agent assignments for ${title}`} onClick={() => setOpen(current => !current)}>···</button>
    {open && <div className="workspace-agent-popover" role="dialog" aria-label={zh ? `${title} 的 Agent 分配` : `Agent assignments for ${title}`}>
      <header><div><strong>{zh ? '分配 Agent' : 'Assign Agents'}</strong><small>{zh ? '可多选；每个 Agent 只保留一个默认工作区。' : 'Select multiple; each Agent keeps one default workspace.'}</small></div>
        <button type="button" className="workspace-popover-close" aria-label={zh ? '关闭' : 'Close'} onClick={() => setOpen(false)}>×</button></header>
      <div className="workspace-agent-options">
        {agents.map(agent => {
          const checked = selectedForAgent(agent.name) === path
          return <label className="workspace-agent-option" key={agent.name}><div className="workspace-agent-identity"><span>{agent.label}</span>{agent.label !== agent.name && <small>{agent.name}</small>}</div>
            <input type="checkbox" checked={checked} disabled={!path && checked} onChange={() => onAssignAgent(agent.name, checked ? '' : path)} /></label>
        })}
        {agents.length === 0 && <p className="workspace-agent-empty">{zh ? '连接后显示 Agent。' : 'Connect to show Agents.'}</p>}
      </div>
      {path && <footer><button type="button" className="danger-action" onClick={() => { setOpen(false); onRemove(path) }}>{zh ? '从工作区列表移除' : 'Remove from workspace list'}</button></footer>}
    </div>}
  </div>
}

export default function WorkspacesView({ connected, busy, profile, agents, paths, selected, selectedForAgent, onAdd, onSelect, onAssignAgent, onRemove, onNewChat }: Props) {
  const { nativeFiles } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const t = (key: string) => translateApp(language, key)
  const [choosing, setChoosing] = React.useState(false)
  const [error, setError] = React.useState('')

  async function addDirectory() {
    setChoosing(true)
    setError('')
    try {
      const picked = await nativeFiles.choose({ directory: true, multiple: false, title: t('ui.workspace.pick') })
      if (typeof picked === 'string') onAdd(picked)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setChoosing(false) }
  }

  return <section className="settings-panel flat-settings-panel workspaces-panel workspace-design-page">
    <header className="design-page-heading"><div><h2>{t('ui.workspace.title')}</h2><p>{zh
      ? profile ? `为当前 Agent「${profile}」选择新会话默认使用的文件夹。` : '选择 Agent 后，可设置它的新会话默认文件夹。'
      : profile ? `Choose the default folder for new sessions with the current Agent “${profile}”.` : 'Select an Agent to set its default folder for new sessions.'}</p></div>
      <button type="button" className="design-primary-button" disabled={choosing} onClick={() => void addDirectory()}>{choosing ? (zh ? '正在选择…' : 'Choosing…') : t('ui.workspace.add')}</button></header>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-design-list">
      {[{ path: '', title: t('ui.workspace.default'), detail: zh ? '不指定本地文件夹' : 'No local folder selected' }, ...paths.map(path => ({ path, title: path.split(/[\\/]/).filter(Boolean).at(-1) || path, detail: path }))].map(({ path, title, detail }) => {
        const assignedAgents = agents.filter(agent => selectedForAgent(agent.name) === path)
        return <article className={`workspace-design-row ${selected === path ? 'is-selected' : ''}`} key={path || 'default'}>
          <button type="button" className="workspace-select-area" disabled={!profile} onClick={() => onSelect(path)} aria-pressed={selected === path} title={detail}>
            <span className="workspace-folder-icon" aria-hidden="true">▣</span><span className="workspace-row-copy"><strong>{title}</strong><small>{detail}</small>
              <small className="workspace-agent-assignment">{zh ? '使用此工作区：' : 'Assigned Agents: '}{assignedAgents.length ? assignedAgents.map(agent => agent.label).join('、') : (zh ? '未分配 Agent' : 'None')}</small></span>
            {selected === path && <span className="workspace-current-label">{zh ? '当前 Agent 默认' : 'Agent default'}</span>}
          </button>
          <button type="button" className="workspace-chat-action" disabled={!connected || busy} onClick={() => onNewChat(path)}>{zh ? '用此工作区新建会话' : 'New chat here'}</button>
          <WorkspaceAgentMenu title={title} path={path} agents={agents} selectedForAgent={selectedForAgent} onAssignAgent={onAssignAgent} onRemove={onRemove} zh={zh} />
        </article>
      })}
    </div>
    <p className="workspace-design-note">{t('ui.workspace.scope.note')}</p>
  </section>
}
