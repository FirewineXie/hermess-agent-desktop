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

  return <section className="settings-panel flat-settings-panel workspaces-panel">
    <div className="row"><h2>{t('ui.workspace.title')}</h2>
      <button type="button" disabled={choosing} onClick={() => void addDirectory()}>{t('ui.workspace.add')}</button></div>
    <p>{t('ui.workspace.intro')}</p>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-list">
      <div className="workspace-row">
        <div><strong>{t('ui.workspace.default')}</strong><small>{t('ui.workspace.default.detail')}</small></div>
        <button type="button" className={selected === '' ? 'selected' : ''} onClick={() => onSelect('')}>{t('ui.workspace.select')}</button>
        <button type="button" disabled={!connected || busy} onClick={() => onNewChat('')}>{t('ui.workspace.new.chat')}</button>
      </div>
      {paths.map(path => <div className="workspace-row" key={path}>
        <div><strong title={path}>{path.split(/[\\/]/).filter(Boolean).at(-1) || path}</strong><small title={path}>{path}</small></div>
        <button type="button" className={selected === path ? 'selected' : ''} onClick={() => onSelect(path)}>{t('ui.workspace.select')}</button>
        <button type="button" disabled={!connected || busy} onClick={() => onNewChat(path)}>{t('ui.workspace.new.chat')}</button>
        <button type="button" onClick={() => onRemove(path)}>{t('ui.workspace.remove')}</button>
      </div>)}
    </div>
    <p>{t('ui.workspace.scope.note')}</p>
  </section>
}
