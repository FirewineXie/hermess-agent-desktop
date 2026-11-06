import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import './managed-files.css'

type Entry = { name: string; path: string; is_directory: boolean; broken_link: boolean; size: number | null; mtime: number | null }
type Listing = { root: string; path: string; parent: string | null; entries: Entry[] }
type Preview = { path: string; name: string; kind: 'text' | 'image' | 'unsupported'; content: string }
type Props = {
  connected: boolean; profile: string | null; profiles: ProfilesSnapshot | null; epoch: string | null; initialRoot: string
  onSelectProfile(name: string): Promise<unknown>
}
const scope = (profile: string) => ({ kind: 'profile' as const, profile })
const bytes = (size: number | null) => size == null ? '—' : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
const modified = (value: number | null) => value == null ? '—' : new Date(value * 1000).toLocaleString()

export default function FilesView({ connected, profile, profiles, epoch, initialRoot, onSelectProfile }: Props) {
  const { extensions, nativeFiles } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [root, setRoot] = React.useState(initialRoot)
  const [listing, setListing] = React.useState<Listing | null>(null)
  const [pathInput, setPathInput] = React.useState('')
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const revision = React.useRef(0)
  const currentPath = listing?.path || ''

  const load = React.useCallback(async (path = '') => {
    const id = ++revision.current
    if (!connected || !profile) { setListing(null); return }
    setLoading(true); setError('')
    try {
      const result = await extensions.request<Listing>(scope(profile), 'managedFiles.list', { root, path })
      if (id !== revision.current) return
      setListing(result); setPathInput(result.path)
    } catch (cause) { if (id === revision.current) setError(describeError(cause, language)) }
    finally { if (id === revision.current) setLoading(false) }
  }, [connected, profile, root, epoch, extensions, language])

  React.useEffect(() => { setPreview(null); setListing(null); void load(); return () => { revision.current++ } }, [load])
  React.useEffect(() => { setRoot(initialRoot); setPreview(null) }, [profile, initialRoot])

  const uploadSources = React.useCallback(async (paths: string[]) => {
    if (!profile || !currentPath || busy || paths.length === 0) return
    const existingNames = new Set(listing?.entries.map(item => item.name.toLocaleLowerCase()) || [])
    const overwrites = paths.filter(path => existingNames.has(path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() || '')).length
    if (overwrites && !window.confirm(zh ? `${overwrites} 个同名文件将被覆盖，继续上传？` : `${overwrites} existing files will be replaced. Continue?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await extensions.request<{ copied: number }>(scope(profile), 'managedFiles.upload', { root, path: currentPath, sources: paths })
      setNotice(zh ? `已上传 ${result.copied} 个文件。` : `Uploaded ${result.copied} files.`)
      await load(currentPath)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }, [profile, currentPath, busy, listing?.entries, zh, extensions, root, load, language])

  React.useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let alive = true
    void nativeFiles.onDrop(event => {
      if (event.type === 'leave') setDragging(false)
      if (event.type === 'enter' || event.type === 'over') setDragging(true)
      if (event.type === 'drop') { setDragging(false); void uploadSources(event.paths) }
    }).then(stop => { if (alive) unsubscribe = stop; else stop() }).catch(() => {})
    return () => { alive = false; unsubscribe?.() }
  }, [nativeFiles, uploadSources])

  const chooseRoot = async () => {
    try {
      const chosen = await nativeFiles.choose({ directory: true, multiple: false, title: zh ? '选择文件根目录' : 'Choose file root' })
      if (typeof chosen === 'string') { setRoot(chosen); setPreview(null); setListing(null) }
    } catch (cause) { setError(describeError(cause, language)) }
  }
  const chooseUpload = async () => {
    try {
      const chosen = await nativeFiles.choose({ directory: false, multiple: true, title: zh ? '选择上传文件' : 'Choose files to upload' })
      if (chosen) await uploadSources(Array.isArray(chosen) ? chosen : [chosen])
    } catch (cause) { setError(describeError(cause, language)) }
  }
  const openEntry = async (entry: Entry) => {
    if (entry.broken_link) return
    if (entry.is_directory) { setPreview(null); await load(entry.path); return }
    if (!profile) return
    setError('')
    try { setPreview(await extensions.request<Preview>(scope(profile), 'managedFiles.read', { root, path: entry.path })) }
    catch (cause) { setError(describeError(cause, language)) }
  }
  const download = async (entry: Entry) => {
    if (!profile || busy || entry.is_directory || entry.broken_link) return
    setError('')
    try {
      const destination = await nativeFiles.save(entry.name)
      if (!destination) return
      setBusy(true)
      await extensions.request(scope(profile), 'managedFiles.copyOut', { root, path: entry.path, destination })
      setNotice(zh ? '文件已保存。' : 'File saved.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const createFolder = async () => {
    if (!profile || !currentPath || busy) return
    const name = window.prompt(zh ? '新文件夹名称' : 'New folder name')?.trim()
    if (!name) return
    setBusy(true); setError('')
    try {
      await extensions.request(scope(profile), 'managedFiles.mkdir', { root, path: currentPath, name })
      setNotice(zh ? '文件夹已创建。' : 'Folder created.'); await load(currentPath)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const remove = async (entry: Entry) => {
    if (!profile || busy || entry.broken_link || !window.confirm(zh ? `永久删除「${entry.name}」${entry.is_directory ? '及其全部内容' : ''}？` : `Permanently delete “${entry.name}”${entry.is_directory ? ' and its contents' : ''}?`)) return
    setBusy(true); setError('')
    try {
      await extensions.request(scope(profile), 'managedFiles.delete', { root, path: entry.path })
      if (preview?.path === entry.path) setPreview(null)
      setNotice(zh ? '已删除。' : 'Deleted.'); await load(currentPath)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  return <main className="managed-files-page">
    <header className="managed-files-heading"><div><p>HERMESS · FILES</p><h1>{zh ? '文件管理' : 'Files'}</h1><span>{zh ? '浏览、上传和整理本机文件。操作范围为当前选定的文件夹。' : 'Browse, upload, and organize local files within the chosen folder.'}</span></div><button type="button" disabled={!connected || loading} onClick={() => void load(currentPath)}>{loading ? (zh ? '读取中…' : 'Loading…') : (zh ? '刷新' : 'Refresh')}</button></header>
    <div className="managed-files-toolbar"><label>Profile <select value={profile || ''} disabled={!connected || busy} onChange={event => { void onSelectProfile(event.target.value).catch(cause => setError(describeError(cause, language))) }}>{(profiles?.profiles || []).map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label><div className="managed-files-root"><small>{zh ? '根目录' : 'Root'}</small><strong title={listing?.root || root}>{listing?.root || (root || (zh ? '当前 Profile 目录' : 'Profile folder'))}</strong></div><button type="button" disabled={busy} onClick={() => void chooseRoot()}>{zh ? '选择文件夹' : 'Choose folder'}</button><button type="button" disabled={busy} onClick={() => { setRoot(''); setPreview(null) }}>{zh ? '个人目录' : 'Profile folder'}</button></div>
    <form className="managed-files-path" onSubmit={event => { event.preventDefault(); void load(pathInput.trim()) }}><button type="button" disabled={!listing?.parent || busy} onClick={() => { if (listing?.parent) void load(listing.parent) }}>↑</button><input value={pathInput} aria-label={zh ? '目录路径' : 'Folder path'} onChange={event => setPathInput(event.target.value)} placeholder={zh ? '输入根目录内的路径' : 'Path within selected root'} /><button type="submit" disabled={busy || !connected}>{zh ? '前往' : 'Go'}</button></form>
    <div className="managed-files-actions"><button type="button" disabled={!listing || busy} onClick={() => void chooseUpload()}>{zh ? '上传文件' : 'Upload files'}</button><button type="button" disabled={!listing || busy} onClick={() => void createFolder()}>{zh ? '新建文件夹' : 'New folder'}</button><span>{zh ? '也可将文件拖入窗口上传' : 'You can also drop files into this window'}</span></div>
    {dragging && <div className="managed-files-drop">{zh ? '松开以上传文件' : 'Release to upload files'}</div>}
    {error && <p className="managed-files-error" role="alert">{error}</p>}{notice && <p className="managed-files-notice" role="status">{notice}</p>}
    {!connected && <div className="managed-files-empty">{zh ? '请先启动本机 Gateway。' : 'Start the local Gateway first.'}</div>}
    {connected && <div className="managed-files-layout"><section className="managed-files-list"><div className="managed-files-list-head"><strong>{listing?.path || (zh ? '正在读取目录…' : 'Loading folder…')}</strong><span>{listing?.entries.length ?? 0} {zh ? '项' : 'items'}</span></div><div className="managed-files-table-head"><span>{zh ? '名称' : 'Name'}</span><span>{zh ? '大小' : 'Size'}</span><span>{zh ? '修改时间' : 'Modified'}</span><span>{zh ? '操作' : 'Actions'}</span></div>{listing?.entries.length === 0 && !loading && <div className="managed-files-empty">{zh ? '此目录为空' : 'This folder is empty'}</div>}{listing?.entries.map(entry => <div className="managed-files-row" key={entry.path}><button type="button" disabled={entry.broken_link} title={entry.path} onClick={() => void openEntry(entry)}><span>{entry.is_directory ? '▣' : entry.broken_link ? '⊘' : '▤'}</span><strong>{entry.name}</strong>{entry.broken_link && <em>{zh ? '链接' : 'Link'}</em>}</button><span>{entry.is_directory ? '—' : bytes(entry.size)}</span><span>{modified(entry.mtime)}</span><div>{!entry.is_directory && !entry.broken_link && <button type="button" disabled={busy} onClick={() => void download(entry)}>{zh ? '下载' : 'Download'}</button>}<button type="button" className="danger" disabled={busy || entry.broken_link} onClick={() => void remove(entry)}>{zh ? '删除' : 'Delete'}</button></div></div>)}</section>
    <section className="managed-files-preview">{!preview ? <div className="managed-files-empty">{zh ? '选择文件查看预览；下载可保存完整文件。' : 'Select a file to preview; download saves the full file.'}</div> : <><div className="managed-files-preview-head"><strong>{preview.name}</strong><button type="button" onClick={() => setPreview(null)} aria-label={zh ? '关闭预览' : 'Close preview'}>×</button></div>{preview.kind === 'text' ? <pre>{preview.content}</pre> : preview.kind === 'image' ? <img src={preview.content} alt={preview.name} /> : <div className="managed-files-empty">{zh ? '此文件无法预览，可使用下载保存。' : 'Preview unavailable. Use download to save this file.'}</div>}</>}</section></div>}
  </main>
}
