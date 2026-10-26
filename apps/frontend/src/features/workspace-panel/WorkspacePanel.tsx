import React from 'react'
import type { DesktopApi } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useLanguage } from '../../i18n'
import TerminalTab from './TerminalTab'
import DirectoryTree from './DirectoryTree'

type PanelFile = Awaited<ReturnType<DesktopApi['workspacePanel']['readFile']>>
type PanelDirectory = Awaited<ReturnType<DesktopApi['workspacePanel']['listDirectory']>>
type PanelTab = { id: string; kind: 'file'; title: string; file: PanelFile }
  | { id: string; kind: 'directory'; title: string; directory: PanelDirectory; revision: number }
  | { id: string; kind: 'terminal'; title: string; terminalId: string }

let nextId = 0

export default function WorkspacePanel({ open, onOpenChange, cwd }: {
  open: boolean; onOpenChange: (open: boolean) => void; cwd: string
}) {
  const desktop = useDesktop()
  const api = desktop.workspacePanel
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [tabs, setTabs] = React.useState<PanelTab[]>([])
  const [activeId, setActiveId] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [width, setWidth] = React.useState(360)
  const [error, setError] = React.useState('')
  const tabsRef = React.useRef(tabs)
  tabsRef.current = tabs
  const active = tabs.find(tab => tab.id === activeId)

  function addTab(tab: PanelTab) {
    setTabs(current => [...current, tab])
    setActiveId(tab.id)
    onOpenChange(true)
    setMenuOpen(false)
    setError('')
  }

  async function showDirectory() {
    setMenuOpen(false)
    try {
      const directory = await api.listDirectory(cwd || undefined)
      const existing = tabsRef.current.find(tab => tab.kind === 'directory' && tab.directory.path === directory.path)
      if (existing) {
        setTabs(current => current.map(tab => tab.id === existing.id && tab.kind === 'directory' ? { ...tab, directory, revision: tab.revision + 1 } : tab))
        setActiveId(existing.id)
        onOpenChange(true)
        setError('')
      } else addTab({ id: `directory-${++nextId}`, kind: 'directory', title: directory.name, directory, revision: 0 })
    } catch { setError(zh ? '无法读取当前目录。' : 'Could not read the current folder.') }
  }

  async function openFile(path: string) {
    const existing = tabsRef.current.find(tab => tab.kind === 'file' && tab.file.path === path)
    if (existing) { setActiveId(existing.id); return }
    try {
      const file = await api.readFile(path)
      addTab({ id: `file-${++nextId}`, kind: 'file', title: file.name, file })
    } catch { setError(zh ? '文件打开失败，或文件过大。' : 'Could not open this file, or it is too large.') }
  }

  async function openTerminal() {
    setMenuOpen(false)
    try {
      const terminal = await api.startTerminal(cwd || undefined)
      addTab({ id: `terminal-${++nextId}`, kind: 'terminal', title: zh ? '终端' : 'Terminal', terminalId: terminal.id })
    } catch { setError(zh ? '终端启动失败。' : 'Could not start terminal.') }
  }

  function closeTab(tab: PanelTab) {
    setTabs(current => current.filter(item => item.id !== tab.id))
    if (tab.id === activeId) setActiveId(tabs.find(item => item.id !== tab.id)?.id || '')
    if (tab.kind === 'terminal') void api.closeTerminal(tab.terminalId)
  }

  React.useEffect(() => {
    return () => {
      for (const tab of tabsRef.current) if (tab.kind === 'terminal') void api.closeTerminal(tab.terminalId)
    }
  }, [api])

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: PointerEvent) => setWidth(Math.max(320, Math.min(window.innerWidth - 636, startWidth + startX - moveEvent.clientX)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  return <aside className={`workspace-panel ${open ? 'is-open' : ''}`} style={{ width: open ? width : 0 }} aria-label={zh ? '右侧工作区' : 'Side workspace'}>
    {open && <div className="panel-resizer" onPointerDown={beginResize} role="separator" aria-label={zh ? '调整面板宽度' : 'Resize panel'} />}
    <div className="panel-tabs">
      <div className="panel-tab-list">{tabs.map(tab => <div key={tab.id} className={`panel-tab ${tab.id === activeId ? 'active' : ''}`}>
        <button type="button" title={tab.title} onClick={() => setActiveId(tab.id)}>{tab.kind === 'terminal' ? '›' : '▤'} {tab.title}</button>
        <button type="button" aria-label={`${zh ? '关闭' : 'Close'} ${tab.title}`} onClick={() => closeTab(tab)}>×</button>
      </div>)}</div>
      <div className="panel-add-wrap">
        <button type="button" className="panel-add" aria-label={zh ? '新建标签' : 'New tab'} onClick={() => setMenuOpen(value => !value)}>＋</button>
        {menuOpen && <div className="panel-add-menu">
          <button type="button" onClick={() => void showDirectory()}>▤ {zh ? '打开文件' : 'Open file'}</button>
          <button type="button" onClick={() => void openTerminal()}>› {zh ? '新建终端' : 'New terminal'}</button>
        </div>}
      </div>
      <button type="button" className="panel-collapse" aria-label={zh ? '收起工作区' : 'Collapse workspace'} onClick={() => onOpenChange(false)}>»</button>
    </div>
    {error && <p className="panel-error">{error}</p>}
    <div className="panel-body">
      {!active && <div className="panel-empty">{zh ? '点击 ＋ 打开文件或终端' : 'Click + to open a file or terminal'}</div>}
      {tabs.map(tab => <div key={tab.id} className="panel-tab-content" style={{ display: tab.id === activeId ? 'flex' : 'none' }}>
        {tab.kind === 'directory' && <DirectoryTree key={tab.revision} directory={tab.directory} onFile={path => void openFile(path)} />}
        {tab.kind === 'file' && <div className="panel-file">
          <div className="panel-file-path" title={tab.file.path}>{tab.file.path}</div>
          {tab.file.kind === 'text' ? <pre>{tab.file.content}</pre> : tab.file.kind === 'image' ? <img src={tab.file.content} alt={tab.file.name} /> : <p>{zh ? '暂不支持预览此文件类型或大小。' : 'This file type or size cannot be previewed.'}</p>}
        </div>}
        {tab.kind === 'terminal' && <TerminalTab id={tab.terminalId} active={open && tab.id === activeId} />}
      </div>)}
    </div>
  </aside>
}
