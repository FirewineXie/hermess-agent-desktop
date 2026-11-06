import type { ModelOAuthPoll } from '@hermess/contracts'

export function modelOAuthPollDelay(seconds: number): number {
  const bounded = Number.isFinite(seconds) ? Math.min(60, Math.max(1, Math.floor(seconds))) : 2
  return bounded * 1000
}

export function modelOAuthTerminalMessage(status: ModelOAuthPoll['status'], detail: string | null, zh: boolean): string | null {
  if (status === 'pending') return null
  if (status === 'approved') return zh ? '登录成功，已重新读取提供商状态。' : 'Login completed. Provider status was refreshed.'
  if (detail) return detail
  const labels: Record<Exclude<ModelOAuthPoll['status'], 'pending' | 'approved'>, [string, string]> = {
    denied: ['登录请求被拒绝。', 'The login request was denied.'],
    expired: ['登录会话已过期。', 'The login session expired.'],
    error: ['登录失败。', 'Login failed.'],
    cancelled: ['登录已取消。', 'Login was cancelled.'],
  }
  return labels[status][zh ? 0 : 1]
}

export function modelOAuthExpiry(expiresAt: string | null, zh: boolean): string | null {
  if (!expiresAt) return null
  const timestamp = Date.parse(expiresAt)
  if (!Number.isFinite(timestamp)) return null
  const minutes = Math.floor((timestamp - Date.now()) / 60_000)
  if (minutes < 0) return zh ? '已过期' : 'Expired'
  if (minutes < 60) return zh ? `${minutes} 分钟后过期` : `Expires in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return zh ? `${hours} 小时后过期` : `Expires in ${hours}h`
  const days = Math.floor(hours / 24)
  return zh ? `${days} 天后过期` : `Expires in ${days}d`
}
