import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'

type Props = {
  connected: boolean
  busy: boolean
  paths: string[]
  selected: string
  onAdd: (path: string) => void
  onSelect: (path: string) => void
  onRemove: (path: string) => void
  onNewChat: (path: string) => void
}

export default function WorkspacesView({ connected, busy, paths, selected, onAdd, onSelect, onRemove, onNewChat }: Props) {
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
    <header className="design-page-heading"><div><h2>{t('ui.workspace.title')}</h2><p>{zh ? '选择任务使用的文件夹。' : 'Choose the folder used for new tasks.'}</p></div>
      <button type="button" className="design-primary-button" disabled={choosing} onClick={() => void addDirectory()}>{choosing ? (zh ? '正在选择…' : 'Choosing…') : t('ui.workspace.add')}</button></header>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-design-list">
      {[{ path: '', title: t('ui.workspace.default'), detail: zh ? '不指定本地文件夹' : 'No local folder selected' }, ...paths.map(path => ({ path, title: path.split(/[\\/]/).filter(Boolean).at(-1) || path, detail: path }))].map(({ path, title, detail }) =>
        <article className={`workspace-design-row ${selected === path ? 'is-selected' : ''}`} key={path || 'default'}>
          <button type="button" className="workspace-select-area" onClick={() => onSelect(path)} aria-pressed={selected === path} title={detail}>
            <span className="workspace-folder-icon" aria-hidden="true">▣</span><span className="workspace-row-copy"><strong>{title}</strong><small>{detail}</small></span>
            {selected === path && <span className="workspace-current-label">{zh ? '当前使用' : 'Selected'}</span>}
          </button>
          <button type="button" className="workspace-chat-action" disabled={!connected || busy} onClick={() => onNewChat(path)}>{zh ? '用此工作区新建会话' : 'New chat here'}</button>
          {path && <details className="workspace-row-menu"><summary aria-label={zh ? `${title} 的更多操作` : `More actions for ${title}`}>···</summary><div>
            <button type="button" onClick={() => onSelect(path)}>{t('ui.workspace.select')}</button>
            <button type="button" className="danger-action" onClick={() => onRemove(path)}>{t('ui.workspace.remove')}</button>
          </div></details>}
        </article>)}
    </div>
    <p className="workspace-design-note">{t('ui.workspace.scope.note')}</p>
  </section>
}
