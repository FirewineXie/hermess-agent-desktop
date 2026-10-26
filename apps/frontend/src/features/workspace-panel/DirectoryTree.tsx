import React from 'react'
import type { DesktopApi, WorkspaceScope } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useLanguage } from '../../i18n'

type Directory = Awaited<ReturnType<DesktopApi['workspacePanel']['listDirectory']>>
type Entry = Directory['entries'][number]

function TreeEntry({ scope, entry, onFile, depth }: { scope: WorkspaceScope; entry: Entry; onFile: (path: string) => void; depth: number }) {
  const api = useDesktop().workspacePanel
  const zh = useLanguage() === 'zh-CN'
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<Entry[] | null>(null)
  const [error, setError] = React.useState(false)

  async function activate() {
    if (!entry.directory) { onFile(entry.path); return }
    if (expanded && !error) { setExpanded(false); return }
    setExpanded(true)
    if (children) return
    try {
      const result = await api.listDirectory(scope, entry.path)
      setChildren(result.entries)
      setError(false)
    } catch { setError(true) }
  }

  return <>
    <button type="button" className="panel-tree-entry" style={{ paddingLeft: 12 + depth * 16 }} title={entry.path}
      aria-expanded={entry.directory ? expanded : undefined} onClick={() => void activate()}>
      <span aria-hidden="true">{entry.directory ? (expanded ? '⌄' : '›') : '▤'}</span> {entry.name}
    </button>
    {entry.directory && expanded && <>
      {error && <div className="panel-tree-note" style={{ paddingLeft: 28 + depth * 16 }}>{zh ? '无法读取目录，点击目录重试' : 'Could not read folder; click to retry'}</div>}
      {children?.length === 0 && <div className="panel-tree-note" style={{ paddingLeft: 28 + depth * 16 }}>{zh ? '空目录' : 'Empty folder'}</div>}
      {children?.map(child => <TreeEntry key={child.path} scope={scope} entry={child} onFile={onFile} depth={depth + 1} />)}
    </>}
  </>
}

export default function DirectoryTree({ scope, directory, onFile }: { scope: WorkspaceScope; directory: Directory; onFile: (path: string) => void }) {
  return <div className="panel-tree" aria-label={directory.path}>
    <div className="panel-file-path" title={directory.path}>{directory.path}</div>
    <div className="panel-tree-list">{directory.entries.map(entry => <TreeEntry key={entry.path} scope={scope} entry={entry} onFile={onFile} depth={0} />)}</div>
  </div>
}
