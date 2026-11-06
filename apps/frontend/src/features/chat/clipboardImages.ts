import type { PendingAttachment } from '@hermess/contracts'

export function clipboardImages(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const files = Array.from(data.files).filter(file => file.type.startsWith('image/'))
  if (files.length) return files
  return Array.from(data.items)
    .filter(item => item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
}

function imageThumbnail(source: string): Promise<string | null> {
  return new Promise(resolve => {
    const image = new Image()
    const timeout = window.setTimeout(() => resolve(null), 5000)
    image.onerror = () => { window.clearTimeout(timeout); resolve(null) }
    image.onload = () => {
      window.clearTimeout(timeout)
      try {
        const scale = Math.min(1, 240 / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) return resolve(null)
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      } catch { resolve(null) }
    }
    image.src = source
  })
}

export async function stageClipboardImage(image: File, attach: (contentBase64: string, name: string) => Promise<PendingAttachment>): Promise<PendingAttachment> {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(image)
  })
  const attached = await attach(contentBase64, image.name || 'pasted-image.png')
  const source = `data:${image.type || 'image/png'};base64,${contentBase64}`
  attached.image_preview = await imageThumbnail(source) || source
  return attached
}
