import React from 'react'
import { createPortal } from 'react-dom'
import type { MediaResource, MediaScope } from '@hermess/contracts'
import { useDesktop } from '../../../app/DesktopContext'
import { useChatMediaScope } from '../ChatMediaContext'
import { mediaName } from '../mediaModel'
import { prepareMediaResource } from '../mediaResource'
import './media-attachment.css'

type Language = 'zh-CN' | 'en-US'
type Props = { source: string; language: Language; label?: string; autoPreview?: boolean }
type Preview = { kind: 'text' | 'html' | 'unsupported'; content: string; truncated: boolean }

export default function MediaAttachment(props: Props) {
  const scope = useChatMediaScope()
  if (!scope) return <span className="chat-media-unavailable">{props.label || mediaName(props.source)} — {props.language === 'zh-CN' ? '连接对应会话后可查看此文件' : 'Connect to this session to view the file'}</span>
  const identity = JSON.stringify([scope.gatewayEpoch, scope.profile, scope.sessionId, props.source])
  return <ScopedMediaAttachment key={identity} {...props} scope={scope} />
}

function ScopedMediaAttachment({ source, language, label, autoPreview, scope }: Props & { scope: MediaScope }) {
  const { media } = useDesktop()
  const [attempt, setAttempt] = React.useState(0)
  const [resource, setResource] = React.useState<MediaResource | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [previewOpen, setPreviewOpen] = React.useState(!!autoPreview)
  const [busy, setBusy] = React.useState(false)
  const [actionStatus, setActionStatus] = React.useState('')
  const alive = React.useRef(true)
  const operation = React.useId()
  const zh = language === 'zh-CN'
  const name = resource?.name || label || mediaName(source)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  React.useEffect(() => {
    setResource(null)
    setFailed(false)
    setActionStatus('')
    return prepareMediaResource(media, scope, source, setResource, () => setFailed(true), `${operation}:${attempt}`)
  }, [media, source, scope.gatewayEpoch, scope.profile, scope.sessionId, attempt, operation])

  const failRendering = () => {
    setFailed(true)
    console.error('[chat-media] rendering failed', { operation: `${operation}:${attempt}`, kind: resource?.kind })
  }

  async function action(kind: 'save' | 'reveal') {
    if (!resource || busy) return
    setBusy(true)
    setActionStatus('')
    console.info('[chat-media] action started', { operation, action: kind })
    try {
      const result = kind === 'save' ? await media.save(resource.id) : await media.reveal(resource.id)
      if (alive.current && kind === 'save' && result) setActionStatus(zh ? '已保存' : 'Saved')
      console.info('[chat-media] action completed', { operation, action: kind, canceled: kind === 'save' && !result })
    } catch {
      if (alive.current) setActionStatus(zh ? '操作失败，请重试。' : 'The action failed. Please try again.')
      console.error('[chat-media] action failed', { operation, action: kind })
    } finally { if (alive.current) setBusy(false) }
  }

  const reload = () => { setExpanded(false); setAttempt(value => value + 1) }
  return <span className="chat-media" data-media-kind={resource?.kind || 'loading'}>
    <span className="chat-media-header"><strong>{name}</strong>{resource && <small>{resource.local ? (zh ? '本地文件' : 'Local file') : (zh ? '远程文件' : 'Remote file')}</small>}</span>
    {!resource && !failed && <span className="chat-media-status" role="status">{zh ? '正在加载文件…' : 'Loading file…'}</span>}
    {failed && <span className="chat-media-status" role="alert">{zh ? '无法显示此文件。文件可能已移走、不可读取或格式不受支持。' : 'Could not display this file. It may have moved, be unreadable, or use an unsupported format.'}</span>}
    {resource && !failed && resource.kind === 'image' && <button className="chat-media-image-button" type="button" onClick={() => setExpanded(true)} aria-label={zh ? `放大图片 ${name}` : `Enlarge ${name}`}>
      <img src={resource.url} alt={label || name} onError={failRendering} onLoad={() => console.info('[chat-media] image displayed', { operation: `${operation}:${attempt}` })} />
    </button>}
    {resource && !failed && resource.kind === 'audio' && <audio controls preload="metadata" src={resource.url} onError={failRendering} onLoadedMetadata={() => console.info('[chat-media] playback ready', { operation: `${operation}:${attempt}`, kind: 'audio' })} />}
    {resource && !failed && resource.kind === 'video' && <video controls playsInline preload="metadata" src={resource.url} onError={failRendering} onLoadedMetadata={() => console.info('[chat-media] playback ready', { operation: `${operation}:${attempt}`, kind: 'video' })} />}
    <span className="chat-media-actions">
      {resource?.kind === 'file' && <button type="button" onClick={() => setPreviewOpen(value => !value)}>{previewOpen ? (zh ? '收起预览' : 'Hide preview') : (zh ? '预览' : 'Preview')}</button>}
      {resource && <button type="button" disabled={busy} onClick={() => void action('save')}>{zh ? '下载 / 另存为' : 'Save as'}</button>}
      {resource?.local && <button type="button" disabled={busy} onClick={() => void action('reveal')}>{zh ? '在文件夹中显示' : 'Show in folder'}</button>}
      {failed && <button type="button" disabled={busy} onClick={reload}>{zh ? '重新加载' : 'Reload'}</button>}
      {actionStatus && <span role="status">{actionStatus}</span>}
    </span>
    {resource?.kind === 'file' && previewOpen && <FilePreview key={resource.id} resource={resource} language={language} />}
    {resource?.kind === 'image' && expanded && <ImageLightbox url={resource.url} name={name} language={language} close={() => setExpanded(false)} />}
  </span>
}

function FilePreview({ resource, language }: { resource: MediaResource; language: Language }) {
  const { media } = useDesktop()
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const operation = React.useId()
  const zh = language === 'zh-CN'
  const pdf = resource.mime.toLowerCase() === 'application/pdf'
  React.useEffect(() => {
    if (pdf) return
    let active = true
    setPreview(null)
    setFailed(false)
    console.info('[chat-media] preview started', { operation, kind: 'file' })
    void media.preview(resource.id).then(value => {
      if (!active) return
      setPreview(value)
      console.info('[chat-media] preview completed', { operation, kind: value.kind, truncated: value.truncated })
    }, () => {
      if (!active) return
      setFailed(true)
      console.error('[chat-media] preview failed', { operation })
    })
    return () => { active = false }
  }, [media, resource.id, pdf, attempt, operation])
  if (pdf) return <span className="chat-media-preview"><iframe title={resource.name} src={resource.url} sandbox="allow-same-origin" /><span>{zh ? '若当前系统无法显示 PDF，请下载后打开。' : 'If PDF viewing is unavailable, save the file and open it.'}</span></span>
  if (failed) return <span className="chat-media-status" role="alert">{zh ? '预览读取失败。' : 'Could not load preview.'}<button type="button" onClick={() => setAttempt(value => value + 1)}>{zh ? '重试' : 'Retry'}</button></span>
  if (!preview) return <span className="chat-media-status" role="status">{zh ? '正在读取预览…' : 'Loading preview…'}</span>
  if (preview.kind === 'unsupported') return <span className="chat-media-status">{zh ? '此格式暂不支持内嵌预览，请下载后打开。' : 'Inline preview is unavailable for this format. Save it to open.'}</span>
  return <span className="chat-media-preview">
    {preview.kind === 'html' ? <StaticHtmlPreview html={preview.content} title={resource.name} /> : <code className="chat-media-text-preview">{preview.content}</code>}
    {preview.kind === 'html' && <span>{zh ? '静态预览：脚本、表单和外部资源不会运行。' : 'Static preview: scripts, forms, and external resources are disabled.'}</span>}
    {preview.truncated && <span>{zh ? '仅显示文件开头，完整内容请下载查看。' : 'Only the beginning is shown. Save the file for the full content.'}</span>}
  </span>
}

function StaticHtmlPreview({ html, title }: { html: string; title: string }) {
  const srcDoc = React.useMemo(() => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    document.querySelectorAll('script,base,meta,link,iframe,frame,object,embed,form').forEach(node => node.remove())
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        if (/^(?:on|href$|xlink:href$|action$|formaction$|srcset$)/i.test(attribute.name)) element.removeAttribute(attribute.name)
      }
    }
    const policy = document.createElement('meta')
    policy.httpEquiv = 'Content-Security-Policy'
    policy.content = "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    document.head.prepend(policy)
    return '<!doctype html>' + document.documentElement.outerHTML
  }, [html])
  return <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} />
}

function ImageLightbox({ url, name, language, close }: { url: string; name: string; language: Language; close: () => void }) {
  const button = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    const previous = document.activeElement
    button.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') { event.preventDefault(); button.current?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  return createPortal(<div className="chat-media-lightbox" role="dialog" aria-modal="true" aria-label={name} onClick={close}>
    <button ref={button} type="button" onClick={close} aria-label={language === 'zh-CN' ? '关闭图片预览' : 'Close image preview'}>×</button>
    <img src={url} alt={name} onClick={event => event.stopPropagation()} />
  </div>, document.body)
}
