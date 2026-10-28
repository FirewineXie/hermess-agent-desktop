import React from 'react'
import type { ProfilesSnapshot, WorkBuddyImportPreview } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { keepFocusInside } from './dialogFocus'

type Props = {
  profiles: ProfilesSnapshot | null
  busy: boolean
  onImport: (path: string, name: string, digest: string) => Promise<{ name: string; served: boolean } | undefined>
  onNotice: (message: string) => void
}

export default function WorkBuddyImportDialog({ profiles, busy, onImport, onNotice }: Props) {
  const { nativeFiles, profiles: profileApi } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [path, setPath] = React.useState('')
  const [preview, setPreview] = React.useState<WorkBuddyImportPreview | null>(null)
  const [name, setName] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const opener = React.useRef<HTMLButtonElement | null>(null)
  const input = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!preview) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    input.current?.focus()
    return () => { document.body.style.overflow = previous }
  }, [preview])

  function close() {
    if (loading) return
    setPreview(null)
    setError('')
    requestAnimationFrame(() => opener.current?.focus())
  }

  async function pick(button: HTMLButtonElement) {
    if (busy || loading) return
    opener.current = button
    setError('')
    const chosen = await nativeFiles.choose({ directory: true, multiple: false, title: zh ? '选择 WorkBuddy 专家包目录' : 'Select a WorkBuddy package folder' })
    if (!chosen || Array.isArray(chosen)) return
    setLoading(true)
    try {
      const result = await profileApi.inspectImport(chosen)
      setPath(chosen)
      setPreview(result)
      setName(result.profileName)
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setLoading(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!preview || loading || busy) return
    const normalized = name.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) || normalized === 'default') {
      setError(zh ? 'Profile 名称只能使用小写字母、数字、-、_，最多 64 个字符。' : 'Use up to 64 lowercase letters, numbers, hyphens or underscores.')
      return
    }
    if (profiles?.profiles.some(profile => profile.name.toLowerCase() === normalized)) {
      setError(zh ? '此 Profile 已存在，请更换名称。' : 'This profile already exists.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await onImport(path, normalized, preview.digest)
      if (!result) return
      setPreview(null)
      requestAnimationFrame(() => opener.current?.focus())
      onNotice(result.served
        ? (zh ? '专家包已导入，可在侧栏打开。外部工具与账号仍需单独配置。' : 'Package imported. Open it from the sidebar; configure external tools separately.')
        : (zh ? '专家包已导入，等待 Gateway 启用。' : 'Package imported, waiting for the Gateway.'))
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setLoading(false)
    }
  }

  return <>
    <button type="button" disabled={busy || loading} onClick={event => void pick(event.currentTarget)}>{loading && !preview ? (zh ? '正在解析…' : 'Inspecting…') : (zh ? '导入 WorkBuddy 专家包' : 'Import WorkBuddy package')}</button>
    {error && !preview && <p className="expert-create-error" role="alert">{error}</p>}
    {preview && <div className="expert-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <form className="expert-create-modal" role="dialog" aria-modal="true" aria-labelledby="workbuddy-import-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } else keepFocusInside(event) }} onSubmit={event => void submit(event)}>
        <header><div><h2 id="workbuddy-import-title">{zh ? '导入预览' : 'Import preview'}</h2><p>{preview.displayName} · {preview.version}</p></div><button type="button" className="expert-modal-close" disabled={loading} onClick={close}>×</button></header>
        <div className="expert-modal-body">
          <label className="expert-name-field">{zh ? 'Profile 名称' : 'Profile name'}<input ref={input} required maxLength={64} value={name} onChange={event => setName(event.target.value)} /></label>
          <section className="expert-recipe-summary"><h3>{zh ? '主理人' : 'Lead'}</h3><p>{preview.lead}</p><h3>{zh ? '成员原文' : 'Member files'}</h3><p>{preview.members.join(zh ? '、' : ', ') || (zh ? '无' : 'None')}</p></section>
          <section className="expert-recipe-summary"><h3>Skill：{preview.skills.length} · MCP：{preview.mcpCount}</h3><p>{preview.skills.join(zh ? '、' : ', ') || (zh ? '无' : 'None')}</p><p>{zh ? `文件 ${preview.fileCount} 个，脚本 ${preview.scriptCount} 个` : `${preview.fileCount} files, ${preview.scriptCount} scripts`}</p></section>
          <section className="expert-recipe-summary"><h3>SOUL.md</h3><p style={{ whiteSpace: 'pre-wrap' }}>{preview.soul}</p></section>
          {preview.notices.map(notice => <p key={notice}>{notice}</p>)}
          {error && <p className="expert-create-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" disabled={loading} onClick={close}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={loading || busy || !name.trim()}>{loading ? (zh ? '正在导入…' : 'Importing…') : (zh ? '确认导入' : 'Import')}</button></footer>
      </form>
    </div>}
  </>
}
