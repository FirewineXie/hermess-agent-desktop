import React from 'react'
import type { BackendInfo } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { createGatewayRecovery, gatewayRecoveryBudget, type ConnectionState } from './gatewayRecovery'

type Options = {
  backend: BackendInfo | null
  remote: boolean
  storagePath: string
  restore: (info: BackendInfo, current: () => boolean) => Promise<void>
  cancelRestore: () => void
  setStatus: (status: string) => void
}

export function useGatewayRecovery(options: Options) {
  const { runtime, events, diagnostics } = useDesktop()
  const language = useLanguage()
  const [state, setState] = React.useState<ConnectionState>(options.remote ? 'connected' : 'stopped')
  const latest = React.useRef({ ...options, language })
  latest.current = { ...options, language }
  const enabled = React.useRef(options.remote)
  const operation = React.useRef(0)
  const record = (event: string) => {
    void diagnostics.recordEvent(latest.current.storagePath, `${event} operation=${operation.current}`).catch(() => {})
  }
  const [recovery] = React.useState(() => createGatewayRecovery({
    budget: () => gatewayRecoveryBudget(latest.current.remote),
    retryTransport: () => latest.current.remote,
    connect: async manualRetry => {
      if (!latest.current.remote) return runtime.reconnect(manualRetry ? { manualRetry: true } : undefined)
      const active = await runtime.activateSavedRemote()
      if (active.mode !== 'remote') throw new Error('Remote Gateway was not activated')
      return { port: 0, pid: 0, replay_epoch: active.replay_epoch }
    },
    restore: (info, current) => latest.current.restore(info, current),
    retired: () => latest.current.cancelRestore(),
    started: () => {
      operation.current += 1
      setState('reconnecting')
      latest.current.setStatus(latest.current.language === 'zh-CN' ? 'Gateway 连接中断，正在自动恢复…' : 'Gateway disconnected. Reconnecting…')
      record('gateway_recovery_started')
    },
    completed: () => {
      setState('connected')
      latest.current.setStatus(latest.current.language === 'zh-CN'
        ? 'Gateway 已重新连接，会话已恢复。'
        : 'Gateway reconnected and session restored.')
      record('gateway_recovery_completed')
    },
    failed: cause => {
      setState('disconnected')
      latest.current.setStatus(latest.current.language === 'zh-CN'
        ? `Gateway 自动恢复失败，可在当前页面重试。${describeError(cause, latest.current.language)}`
        : `Gateway recovery failed. Retry on this page. ${describeError(cause, latest.current.language)}`)
      record('ERROR gateway_recovery_failed')
    },
  }))
  React.useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void events.onDisconnect(() => {
      if (active && enabled.current && latest.current.backend) void recovery.run()
    }).then(stop => { if (active) unlisten = stop; else stop() })
    return () => { active = false; enabled.current = false; recovery.cancel(); unlisten?.() }
  }, [events, recovery])
  const suspend = () => {
    enabled.current = false
    recovery.cancel()
    setState(current => current === 'reconnecting' ? 'disconnected' : current)
    record('gateway_recovery_cancelled')
  }
  return {
    state, connected: state === 'connected',
    retry: async () => { enabled.current = true; await recovery.run(true) },
    recover: async () => { enabled.current = true; await recovery.run() },
    suspend,
    connectedNow: () => { enabled.current = true; setState('connected') },
    stopped: () => { enabled.current = false; setState('stopped') },
    disconnected: () => { enabled.current = true; setState('disconnected') },
  }
}
