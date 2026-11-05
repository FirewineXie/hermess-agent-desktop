import type { BotGroupEvent } from '@hermess/contracts'

export type GroupHistoryItem = { event: BotGroupEvent; notice?: string }

const failureReasons: Record<string, [string, string]> = {
  runtime_offline: ['运行时未连接', 'Runtime offline'],
  queued_expired: ['排队等待超时', 'Queue wait expired'],
  delivery_timeout: ['请求超时', 'Delivery timed out'],
  agent_blocked: ['Bot 暂时无法执行', 'Bot is blocked'],
  cancelled: ['任务已取消', 'Task cancelled'],
  provider_auth_or_access: ['模型服务认证或访问失败', 'Model provider authentication or access failed'],
  provider_quota_limit: ['模型服务额度不足', 'Model provider quota exhausted'],
  provider_rate_limit: ['模型服务请求过于频繁', 'Model provider rate limit reached'],
  provider_server_error: ['模型服务端出错', 'Model provider server error'],
  context_overflow: ['对话内容超过模型上下文限制', 'Model context limit exceeded'],
  missing_config: ['缺少模型配置', 'Model configuration missing'],
  model_unavailable: ['所选模型不可用', 'Selected model unavailable'],
  target_scope_unresolved: ['无法读取此 Bot 的模型凭据', 'Bot model credentials unavailable'],
}

export function groupHistoryItems(events: BotGroupEvent[], zh: boolean): GroupHistoryItem[] {
  const notices: Record<string, string> = zh ? {
    'turn.failed': 'Bot 回复失败', 'turn.cancelled': 'Bot 回复已取消',
    'turn.deferred': 'Bot 回复已暂停', 'member.unavailable': 'Bot 暂不可用',
    'room.stop_requested': '群聊已请求停止', 'room.disbanded': '群聊已解散',
    'authority.lost': '群聊连接已失效',
  } : {
    'turn.failed': 'Bot reply failed', 'turn.cancelled': 'Bot reply cancelled',
    'turn.deferred': 'Bot reply deferred', 'member.unavailable': 'Bot unavailable',
    'room.stop_requested': 'Group stop requested', 'room.disbanded': 'Group disbanded',
    'authority.lost': 'Group connection lost',
  }
  return events.flatMap(event => {
    if (event.kind === 'message.user' || event.kind === 'message.member') return [{ event }]
    if (event.kind === 'room.activity' && event.payload.status === 'bounded') {
      return [{ event, notice: zh ? '本轮讨论已达到上限' : 'Discussion limit reached' }]
    }
    const reason = event.kind === 'turn.failed' && typeof event.payload.reason_code === 'string'
      ? failureReasons[event.payload.reason_code]?.[zh ? 0 : 1] : undefined
    const notice = notices[event.kind] && (reason ? `${notices[event.kind]}：${reason}` : notices[event.kind])
    return notice ? [{ event, notice }] : []
  })
}
