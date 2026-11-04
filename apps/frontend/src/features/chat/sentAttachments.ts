import type { PendingAttachment } from '@hermess/contracts'

export type SentAttachment = { kind: 'image' | 'file'; name: string; bytes: number; preview?: string }

export function sentAttachments(attachments: PendingAttachment[]): SentAttachment[] {
  return attachments.map(item => ({
    kind: item.kind, name: item.name, bytes: item.bytes,
    ...(item.kind === 'image' && item.image_preview ? { preview: item.image_preview } : {}),
  }))
}
