import React from 'react'
import { parseDocument } from 'yaml'
import { useDesktop } from '../../app/DesktopContext'
import type { Language } from '../../i18n'
import { gatewayLanguageDecision } from './gatewayLanguagePolicy'

type Options = {
  profiles: string[]
  epoch: string | null
  language: Language
  storagePath: string
  restart: () => Promise<unknown>
  reportError: (message: string) => void
}

export function useGatewayLanguage({ profiles, epoch, language, storagePath, restart, reportError }: Options) {
  const { agentSettings, diagnostics } = useDesktop()
  const profileNames = [...new Set(profiles)].sort().join('|')
  const pending = React.useRef<Promise<void>>(Promise.resolve())
  const restartRef = React.useRef(restart)
  const reportErrorRef = React.useRef(reportError)
  restartRef.current = restart
  reportErrorRef.current = reportError

  React.useEffect(() => {
    if (!profileNames || !epoch) return
    let cancelled = false
    const desired = language === 'zh-CN' ? 'zh' : 'en'
    pending.current = pending.current.catch(() => {}).then(async () => {
      if (cancelled) return
      let changed = false
      let failed = false
      for (const profile of profileNames.split('|')) {
        if (cancelled) return
        try {
          const scope = { kind: 'profile' as const, profile }
          const marker = `hermess:gateway-language:${storagePath}:${profile}`
          const managed = localStorage.getItem(marker)
          const raw = await agentSettings.raw(scope)
          if (cancelled) return
          const document = parseDocument(raw.yaml)
          if (document.errors.length) throw document.errors[0]
          const configured = document.getIn(['display', 'language'])
          const decision = gatewayLanguageDecision(configured, managed, desired)
          if (decision === 'preserve') {
            if (managed) localStorage.removeItem(marker)
            continue // An explicit Profile setting takes precedence over the desktop default.
          }
          if (decision === 'same') continue
          void diagnostics.recordEvent(storagePath, `gateway_language_sync_start profile=${profile} language=${desired}`).catch(() => {})
          await agentSettings.saveField(scope, 'display.language', desired)
          const saved = await agentSettings.config(scope)
          if (saved.display == null || typeof saved.display !== 'object' || (saved.display as Record<string, unknown>).language !== desired) {
            throw new Error('Gateway language readback did not match the selected language')
          }
          changed = true
          localStorage.setItem(marker, desired)
        } catch {
          failed = true
          void diagnostics.recordEvent(storagePath, `gateway_language_sync_failed profile=${profile}`).catch(() => {})
        }
      }
      if (changed && !cancelled) {
        try {
          const result = await restartRef.current()
          void diagnostics.recordEvent(storagePath, `gateway_language_sync_${result === null ? 'deferred' : 'completed'} language=${desired}`).catch(() => {})
          if (result === null && !cancelled) reportErrorRef.current(language === 'zh-CN'
            ? 'Gateway 提示语言已保存；当前任务结束后请重启应用，新的提示语言才会生效。'
            : 'Gateway message language was saved. Restart the app after the current task to apply it.')
        } catch {
          failed = true
          void diagnostics.recordEvent(storagePath, 'gateway_language_restart_failed').catch(() => {})
        }
      }
      if (failed && !cancelled) reportErrorRef.current(language === 'zh-CN'
        ? '部分 Gateway 提示语言未能同步，请在高级配置中检查“显示 / 语言”。'
        : 'Some Gateway message languages could not be synced. Check Display / Language in advanced settings.')
    })
    return () => { cancelled = true }
  }, [agentSettings, diagnostics, profileNames, epoch, language, storagePath])
}
