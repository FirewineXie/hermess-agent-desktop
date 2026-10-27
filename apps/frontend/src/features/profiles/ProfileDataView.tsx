import React from 'react'
import type { ProfileDataListing } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

export default function ProfileDataView({ profile, served }: { profile: string | null; served: boolean }) {
  const api = useDesktop().profiles
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [relativePath, setRelativePath] = React.useState('')
  const [listing, setListing] = React.useState<ProfileDataListing | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = React.useState(0)
  const [opening, setOpening] = React.useState(false)
  const [openError, setOpenError] = React.useState('')
  const parent = listing?.parent ?? (relativePath ? relativePath.split('/').slice(0, -1).join('/') : null)

  React.useEffect(() => {
    if (!served || !profile) return
    let cancelled = false
    setState('loading')
    setListing(null)
    void api.listDataDirectory({ kind: 'profile', profile }, relativePath).then(result => {
      if (cancelled) return
      setListing(result)
      setState('ready')
    }).catch(() => {
      if (!cancelled) setState('error')
    })
    return () => { cancelled = true }
  }, [api, profile, served, relativePath, revision])

  const openExternal = async () => {
    if (!served || !profile || opening) return
    setOpening(true)
    setOpenError('')
    try {
      await api.openDataDirectory({ kind: 'profile', profile })
    } catch (error) {
      setOpenError(describeError(error, language))
    } finally {
      setOpening(false)
    }
  }

  return <section className="profile-data-panel" aria-label={zh ? '当前专家的数据目录' : 'Current expert data directory'}>
    <div className="profile-data-heading">
      <div><h3>{zh ? '当前专家的数据目录' : 'Current expert data directory'}</h3><p>{zh ? '在此浏览目录结构和文件名称。' : 'Browse folders and file names here.'}</p></div>
      <button type="button" disabled={!served || opening} onClick={() => { void openExternal() }}>{opening ? (zh ? '正在打开…' : 'Opening…') : (zh ? '在文件管理器打开' : 'Open in file manager')}</button>
    </div>
    {openError && <p className="profile-data-error" role="alert">{zh ? '打开目录失败：' : 'Could not open folder: '}{openError}</p>}
    {!served ? <p className="profile-data-note">{zh ? '运行时未连接或尚未服务此专家。' : 'Runtime disconnected or not serving this expert.'}</p> : <>
      <div className="profile-data-toolbar">
        <button type="button" disabled={state === 'loading' || parent === null} onClick={() => setRelativePath(parent || '')}>{zh ? '返回上级' : 'Up'}</button>
        <span className="profile-data-current-path" title={listing?.path || ''}>{listing?.path || (zh ? '读取目录中…' : 'Loading directory…')}</span>
        <button type="button" disabled={state === 'loading'} onClick={() => setRevision(value => value + 1)}>{zh ? '刷新' : 'Refresh'}</button>
      </div>
      {state === 'loading' && <p className="profile-data-note">{zh ? '正在读取目录…' : 'Loading folder…'}</p>}
      {state === 'error' && <div className="profile-data-note" role="alert">{zh ? '目录读取失败或已不存在。' : 'Folder is unavailable or could not be read.'} <button type="button" onClick={() => setRevision(value => value + 1)}>{zh ? '重试' : 'Retry'}</button></div>}
      {state === 'ready' && listing && <div className="profile-data-list">
        {listing.entries.length === 0 && <p className="profile-data-note">{zh ? '此目录为空。' : 'This folder is empty.'}</p>}
        {listing.entries.map(entry => entry.directory
          ? <button className="profile-data-row" type="button" key={entry.relativePath} onClick={() => setRelativePath(entry.relativePath)}><span className="profile-data-row-icon" aria-hidden="true">▣</span><span className="profile-data-row-name">{entry.name}</span><small>{zh ? '文件夹' : 'Folder'}</small><span aria-hidden="true">›</span></button>
          : <div className="profile-data-row" key={entry.relativePath}><span className="profile-data-row-icon" aria-hidden="true">▤</span><span className="profile-data-row-name">{entry.name}</span><small>{entry.link ? (zh ? '链接' : 'Link') : (zh ? '文件' : 'File')}</small></div>)}
      </div>}
    </>}
  </section>
}
