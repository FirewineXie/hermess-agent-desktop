import type { ChannelStatus, WhatsAppMode } from '@hermess/contracts'

export function hasPendingChannelRestart(rows: ChannelStatus[], localPending: boolean): boolean {
  return localPending || rows.some(row => row.state === 'pending_restart')
}

export type ChannelStatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export function channelStatusTone(state: string | undefined): ChannelStatusTone {
  if (state === 'connected') return 'success'
  if (state === 'pending_restart' || state === 'starting' || state === 'degraded' || state === 'gateway_stopped') return 'warning'
  if (state === 'fatal' || state === 'startup_failed' || state === 'disconnected') return 'danger'
  return 'neutral'
}

export function normalizeTelegramUserId(value: string): string | null {
  const normalized = value.trim()
  return /^\d+$/.test(normalized) ? normalized : null
}

export function addTelegramUserId(values: string[], candidate: string): string[] | null {
  const normalized = normalizeTelegramUserId(candidate)
  if (!normalized) return null
  return values.includes(normalized) ? values : [...values, normalized]
}

export function removeTelegramUserId(values: string[], value: string): string[] {
  return values.filter(candidate => candidate !== value)
}

export function configuredWhatsAppMode(value: string | undefined): WhatsAppMode {
  return value === 'self-chat' ? 'self-chat' : 'bot'
}

function safeChannelUrl(value: string | null | undefined, httpsOnly: boolean): string | null {
  if (!value || value.length > 2048 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    if (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:')) return null
    return url.href
  } catch { return null }
}

export function safeChannelDocsUrl(value: string | null | undefined): string | null {
  return safeChannelUrl(value, true)
}

export function safeChannelIngressUrl(value: string | null | undefined): string | null {
  return safeChannelUrl(value, false)
}

export type ChannelFieldValidation =
  | { kind: 'telegram-token' }
  | { kind: 'telegram-user'; value: string }
  | { kind: 'slack-token'; prefix: string }
  | { kind: 'slack-user'; value: string }

export function validateChannelField(key: string, value: string): ChannelFieldValidation | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (key === 'TELEGRAM_BOT_TOKEN' && !/^\d+:[A-Za-z0-9_-]{30,}$/.test(trimmed)) {
    return { kind: 'telegram-token' }
  }
  if (key === 'TELEGRAM_ALLOWED_USERS') {
    const invalid = trimmed.split(',').map(part => part.trim()).filter(Boolean).find(part => !/^\d+$/.test(part))
    if (invalid) return { kind: 'telegram-user', value: invalid }
  }
  const prefix = key === 'SLACK_BOT_TOKEN' ? 'xoxb-' : key === 'SLACK_APP_TOKEN' ? 'xapp-' : ''
  if (prefix && !trimmed.startsWith(prefix)) return { kind: 'slack-token', prefix }
  if (key === 'SLACK_ALLOWED_USERS') {
    const invalid = trimmed.split(',').map(part => part.trim()).filter(Boolean)
      .find(part => part !== '*' && !/^[UW][A-Z0-9]{2,}$/.test(part))
    if (invalid) return { kind: 'slack-user', value: invalid }
  }
  return null
}
