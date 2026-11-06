import { useLanguage } from '../../i18n'
import type { ConnectionState } from './gatewayRecovery'
import './gateway-recovery.css'

export default function GatewayRecoveryNotice({ state, message, onRetry }: {
  state: ConnectionState; message: string; onRetry: () => Promise<void>
}) {
  const language = useLanguage()
  if (state !== 'reconnecting' && state !== 'disconnected') return null
  return <div className="gateway-recovery-notice" role={state === 'disconnected' ? 'alert' : 'status'}>
    <span>{message}</span>
    {state === 'disconnected' && <button type="button" onClick={() => void onRetry()}>{language === 'zh-CN' ? '重新连接' : 'Reconnect'}</button>}
  </div>
}
