import React from 'react'
import type { SentAttachment } from '../sentAttachments'
import './sent-attachments.css'

export default function SentAttachmentList({ attachments, language }: { attachments: SentAttachment[]; language: 'zh-CN' | 'en-US' }) {
  const [selected, setSelected] = React.useState<number | null>(null)
  const active = selected == null ? null : attachments[selected]
  React.useEffect(() => {
    if (selected == null) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selected])
  return <>
    <ul className="sent-attachments">{attachments.map((attachment, index) => <li key={`${attachment.name}-${index}`}>
      {attachment.kind === 'image' && attachment.preview
        ? <button type="button" className="sent-attachment-image" onClick={() => setSelected(index)} aria-label={language === 'zh-CN' ? `预览图片 ${attachment.name}` : `Preview image ${attachment.name}`}><img src={attachment.preview} alt={attachment.name} /></button>
        : <span className="sent-attachment-icon" aria-hidden="true">{attachment.kind === 'image' ? '▧' : '▤'}</span>}
      <span className="sent-attachment-name">{attachment.name}</span>
      <small>{attachment.bytes} {language === 'zh-CN' ? '字节' : 'bytes'}</small>
    </li>)}</ul>
    {active?.preview && <div className="sent-attachment-lightbox" role="dialog" aria-modal="true" aria-label={active.name} onClick={() => setSelected(null)}>
      <button type="button" className="sent-attachment-close" onClick={() => setSelected(null)} aria-label={language === 'zh-CN' ? '关闭预览' : 'Close preview'}>×</button>
      <img src={active.preview} alt={active.name} onClick={event => event.stopPropagation()} />
    </div>}
  </>
}
