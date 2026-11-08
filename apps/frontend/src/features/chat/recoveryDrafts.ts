import { captureWorkspaceState } from '../../app/profile-scope/ProfileWorkspace.ts'
import type { PendingAttachment } from './model'

export function captureChatDrafts(epoch: string) {
  const profilesWithImages = new Set<string>()
  const restore = captureWorkspaceState(epoch, {
    'chat:draft': value => value,
    // Gateway-staged image paths expire with the old instance. Never resend automatically.
    'chat:attachments': (value, profile) => {
      const attachments = value as PendingAttachment[]
      if (attachments.some(item => item.kind === 'image')) profilesWithImages.add(profile)
      return attachments.filter(item => item.kind === 'file')
    },
  })
  return Object.assign(restore, { profilesWithImages })
}
