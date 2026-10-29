import type { NotificationKind } from './notificationPolicy'

export type NotificationPreferences = Record<NotificationKind, boolean> & {
  enabled: boolean
  sound: boolean
}

export const notificationPreferencesKey = 'hermess:notification-preferences'
export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  approval: true,
  input: true,
  turnDone: true,
  turnError: true,
  backgroundDone: true,
  credits: true,
  plugin: true,
  sound: true,
}

export function readNotificationPreferences(storage: Pick<Storage, 'getItem'> = localStorage): NotificationPreferences {
  try {
    const saved = JSON.parse(storage.getItem(notificationPreferencesKey) || '{}') as Partial<NotificationPreferences>
    return { ...defaultNotificationPreferences, ...saved }
  } catch {
    return defaultNotificationPreferences
  }
}

export function writeNotificationPreferences(value: NotificationPreferences, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(notificationPreferencesKey, JSON.stringify(value))
}
