import type { ConnectionState } from './gatewayRecovery'

export function connectionLabel(state: ConnectionState, language: 'zh-CN' | 'en-US') {
  const labels = language === 'zh-CN'
    ? { connected: '已连接', reconnecting: '重连中…', disconnected: '连接已断开', stopped: '未启动' }
    : { connected: 'Connected', reconnecting: 'Reconnecting…', disconnected: 'Disconnected', stopped: 'Not started' }
  return labels[state]
}
