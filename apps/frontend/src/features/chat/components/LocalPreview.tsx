import React from 'react'
import { useDesktop } from '../../../app/DesktopContext'
import { htmlPreviewSandbox, PREVIEW_ERROR_MESSAGE, PREVIEW_LOAD_MESSAGE, PREVIEW_READY_MESSAGE, PREVIEW_RESIZE_MESSAGE, type PreviewTheme } from '../htmlPreviewSandbox'
import './local-preview.css'

type Language = 'zh-CN' | 'en-US'

function previewTheme(): PreviewTheme {
  const root = document.documentElement
  const dark = root.dataset.colorTheme === 'dark'
  return {
    foreground: dark ? '#e7edf6' : '#20242d', mutedForeground: dark ? '#9aa8bb' : '#68717d',
    accent: dark ? '#78aaff' : '#1b6ffd', border: dark ? '#2a394b' : '#dce3ea',
    card: dark ? '#131d2a' : '#ffffff', font: getComputedStyle(root).fontFamily || 'system-ui, sans-serif',
  }
}

export default function LocalPreview({ path, language }: { path: string; language: Language }) {
  const { localPreview } = useDesktop()
  const iframe = React.useRef<HTMLIFrameElement>(null)
  const operation = React.useRef(0)
  const token = React.useMemo(() => crypto.randomUUID(), [])
  const previewId = token.slice(0, 8)
  const shell = React.useMemo(() => htmlPreviewSandbox(token), [token])
  const [content, setContent] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [height, setHeight] = React.useState(360)
  const [error, setError] = React.useState('')
  const zh = language === 'zh-CN'

  const load = React.useCallback(async () => {
    const id = ++operation.current
    setBusy(true)
    setReady(false)
    setError('')
    setContent('')
    console.info('[local-preview] load started', { preview: previewId, operation: id, extension: path.split('.').at(-1)?.toLowerCase() || '' })
    try {
      const result = await localPreview.readHtml(path)
      if (id !== operation.current) return
      setContent(result.content)
      console.info('[local-preview] file loaded', { preview: previewId, operation: id, characters: result.content.length })
    } catch {
      if (id !== operation.current) return
      console.error('[local-preview] load failed', { preview: previewId, operation: id })
      setError(zh ? '无法读取此 HTML 文件。文件可能不存在、格式不受支持或超过大小限制。' : 'Could not read this HTML file. It may be missing, unsupported, or oversized.')
    } finally {
      if (id === operation.current) setBusy(false)
    }
  }, [localPreview, path, previewId, zh])

  React.useEffect(() => {
    void load()
    return () => { operation.current += 1 }
  }, [load])

  React.useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.data?.token !== token) return
      if (event.data.type === PREVIEW_RESIZE_MESSAGE && Number.isFinite(event.data.height)) setHeight(Math.min(800, Math.max(180, event.data.height)))
      if (event.data.type === PREVIEW_READY_MESSAGE) { setReady(true); console.info('[local-preview] sandbox ready', { preview: previewId, operation: operation.current }) }
      if (event.data.type === PREVIEW_ERROR_MESSAGE) { setError(zh ? 'HTML 已读取，但无法在安全预览中运行。' : 'The HTML was read but could not run in the secure preview.'); console.error('[local-preview] sandbox failed', { preview: previewId, operation: operation.current }) }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [previewId, token, zh])

  const sendContent = () => iframe.current?.contentWindow?.postMessage({ type: PREVIEW_LOAD_MESSAGE, token, html: content, theme: previewTheme() }, '*')

  return <div className="local-preview">
    <div className="local-preview-header"><span title={path}>{path.split(/[\\/]/).at(-1) || path}</span>
      <button type="button" disabled={busy} onClick={() => void load()}>{busy ? (zh ? '读取中…' : 'Loading…') : (zh ? '重新加载' : 'Reload')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {content && !error && <div className="local-preview-frame-wrap">
      <iframe ref={iframe} title={zh ? `${path.split(/[\\/]/).at(-1) || path} 安全预览` : `Secure preview of ${path.split(/[\\/]/).at(-1) || path}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={shell} style={{ height }} onLoad={sendContent} />
      {!ready && <div className="local-preview-loading" role="status">{zh ? '正在启动安全预览…' : 'Starting secure preview…'}</div>}
    </div>}
  </div>
}
