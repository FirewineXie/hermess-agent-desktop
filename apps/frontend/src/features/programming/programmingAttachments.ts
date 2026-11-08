const imageExtension = /\.(png|jpe?g|gif|webp)$/i
const maxImageBytes = 20 * 1024 * 1024

export function splitProgrammingPaths(paths: string[]) {
  const unique = [...new Set(paths)]
  return { images: unique.filter(path => imageExtension.test(path)), files: unique.filter(path => !imageExtension.test(path)) }
}

export function programmingAttachmentName(value: string, index: number, zh: boolean) {
  return value.startsWith('data:') ? `${zh ? '粘贴图片' : 'Pasted image'} ${index + 1}` : value.split(/[\\/]/).at(-1) || value
}

export function programmingAttachmentText(draft: string, files: string[]) {
  return [draft, ...files.map(path => `@${JSON.stringify(path)}`)].filter(Boolean).join('\n')
}

export async function readProgrammingImages(files: File[], existing: string[], zh: boolean): Promise<string[]> {
  if (existing.length + files.length > 4) throw new Error(zh ? '每次最多添加四张图片附件。' : 'Attach up to four images per turn.')
  if (files.some(file => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type))) {
    throw new Error(zh ? '图片支持 PNG、JPEG、GIF、WebP。' : 'Images must be PNG, JPEG, GIF or WebP.')
  }
  const storedBytes = existing.filter(value => value.startsWith('data:')).reduce((total, value) => {
    const base64 = value.slice(value.indexOf(',') + 1)
    return total + base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  }, 0)
  if (storedBytes + files.reduce((total, file) => total + file.size, 0) > maxImageBytes) {
    throw new Error(zh ? '图片附件合计不能超过 20 MiB。' : 'Image attachments must total at most 20 MiB.')
  }
  return Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error(zh ? '无法读取图片。' : 'Could not read image.'))
    reader.onabort = () => reject(new Error(zh ? '图片读取已取消。' : 'Image read cancelled.'))
    reader.readAsDataURL(file)
  })))
}
