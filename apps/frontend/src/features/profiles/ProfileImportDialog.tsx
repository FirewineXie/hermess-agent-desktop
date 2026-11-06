import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { keepFocusInside } from '../extensions/dialogFocus'

type Props = {
  language: 'zh-CN' | 'en-US'
  busy: boolean
  onImport: (archive: string, name?: string) => Promise<{ name: string; warnings?: string[]; served: boolean } | undefined>
  onClose: () => void
  onImported: (message: string) => void
}

export default function ProfileImportDialog({ language, busy, onImport, onClose, onImported }: Props) {
  const { nativeFiles } = useDesktop()
  const zh = language === 'zh-CN'
  const [archive, setArchive] = React.useState('')
  const [name, setName] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const close = () => { if (!submitting) onClose() }

  const choose = async () => {
    setError('')
    try {
      const selected = await nativeFiles.choose({ directory: false, multiple: false, title: zh ? '选择 Profile 归档（.tar.gz 或 .tgz）' : 'Choose a Profile archive (.tar.gz or .tgz)' })
      if (typeof selected === 'string') setArchive(selected)
    } catch (cause) {
      setError(describeError(cause, language))
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!archive || submitting || busy) return
    const normalized = name.trim().toLowerCase()
    if (normalized && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
      setError(zh ? '覆盖标识须以字母或数字开头，仅含小写字母、数字、-、_，最多 64 个字符。' : 'The override ID must use up to 64 lowercase letters, numbers, hyphens or underscores.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await onImport(archive, normalized || undefined)
      if (!result) return
      const warning = result.warnings?.length ? (zh ? '，但部分产品能力初始化失败，请查看诊断日志' : ', but some product capabilities could not be initialized; check diagnostics') : ''
      onImported(result.served
        ? (zh ? `Profile“${result.name}”已导入并启用${warning}。` : `Profile “${result.name}” was imported and enabled${warning}.`)
        : (zh ? `Profile“${result.name}”已导入，等待 Gateway 启用${warning}。` : `Profile “${result.name}” was imported and is waiting for the Gateway${warning}.`))
      onClose()
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setSubmitting(false)
    }
  }

  const basename = archive.split(/[\\/]/).pop() || archive
  return <div className="profile-delete-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <form className="profile-delete-dialog profile-import-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-import-title" onSubmit={event => void submit(event)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } else keepFocusInside(event) }}>
      <h2 id="profile-import-title">{zh ? '导入 Profile 归档' : 'Import Profile archive'}</h2>
      <p>{zh ? '只接受 Hermes 标准 .tar.gz/.tgz 归档。导入会安全解包并移除归档中的外部运行状态。' : 'Only standard Hermes .tar.gz/.tgz archives are accepted. Import safely extracts the archive and removes foreign runtime state.'}</p>
      <button type="button" className="profile-import-choose" disabled={submitting} onClick={() => void choose()}>{archive ? (zh ? '重新选择归档' : 'Choose another archive') : (zh ? '选择归档' : 'Choose archive')}</button>
      {archive && <p className="profile-import-file" title={archive}>{basename}</p>}
      <label>{zh ? '新的内部标识（可选）' : 'New internal ID (optional)'}<input maxLength={64} spellCheck={false} autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder={zh ? '留空则使用归档顶层目录名' : 'Leave blank to use the archive root name'} /></label>
      {error && <p className="profile-directory-error" role="alert">{error}</p>}
      <div className="profile-delete-actions"><button type="button" disabled={submitting} onClick={close}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={submitting || busy || !archive}>{submitting ? (zh ? '正在导入…' : 'Importing…') : (zh ? '导入 Profile' : 'Import profile')}</button></div>
    </form>
  </div>
}
