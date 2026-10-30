import React from 'react'
import { useDesktop } from '../../../app/DesktopContext'

type Language = 'zh-CN' | 'en-US'
type PreviewImage = { src: string; alt: string }

function embeddedImages(html: string): PreviewImage[] {
  const images: PreviewImage[] = []
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = match[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2] || ''
    if (!/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z\d+/=]+$/i.test(src)) continue
    const alt = match[0].match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2] || ''
    images.push({ src, alt })
    if (images.length === 32) break
  }
  return images
}

export default function LocalPreview({ path, language }: { path: string; language: Language }) {
  const { localPreview } = useDesktop()
  const [images, setImages] = React.useState<PreviewImage[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [selected, setSelected] = React.useState<number | null>(null)
  const zh = language === 'zh-CN'

  async function load() {
    setBusy(true)
    setError('')
    try {
      const result = await localPreview.readHtml(path)
      const found = embeddedImages(result.content)
      if (!found.length) throw new Error('No embedded images')
      setImages(found)
    } catch {
      setError(zh ? '无法预览：文件不存在、过大，或没有内嵌图片。' : 'Preview unavailable: missing or oversized file, or no embedded images.')
    } finally {
      setBusy(false)
    }
  }

  React.useEffect(() => { void load() }, [path])

  return <div className="local-preview">
    <div className="local-preview-header"><span title={path}>{path.split(/[\\/]/).at(-1) || path}</span>
      {!images && <button type="button" disabled={busy} onClick={() => void load()}>{busy ? (zh ? '读取中…' : 'Loading…') : (zh ? '重试预览' : 'Retry preview')}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {images && <div className="local-preview-grid">{images.map((image, index) => <button type="button" key={index} onClick={() => setSelected(index)} aria-label={image.alt || `${zh ? '图片' : 'Image'} ${index + 1}`}>
      <img src={image.src} alt={image.alt} loading="lazy" /><span>{image.alt || `${zh ? '图片' : 'Image'} ${index + 1}`}</span>
    </button>)}</div>}
    {selected !== null && images?.[selected] && <div className="local-preview-lightbox" role="dialog" aria-modal="true" aria-label={images[selected].alt || (zh ? '图片预览' : 'Image preview')} onClick={() => setSelected(null)}>
      <button type="button" aria-label={zh ? '关闭预览' : 'Close preview'} onClick={() => setSelected(null)}>×</button>
      <img src={images[selected].src} alt={images[selected].alt} />
    </div>}
  </div>
}
