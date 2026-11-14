import { isDesktopFailure, type DesktopFailureCode } from '@hermess/contracts'
import { translateApp, type Language } from '../i18n'

const messageKeys: Record<DesktopFailureCode, string> = {
  operation_failed: 'ui.desktop.error.operation_failed',
  runtime_unavailable: 'ui.desktop.error.runtime_unavailable',
  connection_lost: 'ui.desktop.error.connection_lost',
  timeout: 'ui.desktop.error.timeout',
  conflict: 'ui.desktop.error.conflict',
  invalid_input: 'ui.desktop.error.invalid_input',
  pairing_not_found: 'ui.desktop.error.pairing_not_found',
  pairing_locked: 'ui.desktop.error.pairing_locked',
  session_owner_unknown: 'ui.desktop.error.session_owner_unknown',
  session_profile_mismatch: 'ui.desktop.error.session_profile_mismatch',
  session_superseded: 'ui.desktop.error.session_superseded',
  web_access_address: 'ui.desktop.error.web_access_address',
  web_access_tls: 'ui.desktop.error.web_access_tls',
  web_access_bind: 'ui.desktop.error.web_access_bind',
  web_access_settings: 'ui.desktop.error.web_access_settings',
  web_access_link: 'ui.desktop.error.web_access_link',
  web_access_restart_deferred: 'ui.desktop.error.web_access_restart_deferred',
  web_access_managed_policy: 'ui.desktop.error.web_access_managed_policy',
}

export function describeError(error: unknown, language: Language): string {
  if (isDesktopFailure(error)) return translateApp(language, messageKeys[error.code])
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return translateApp(language, messageKeys.operation_failed)
  return translateApp(language, messageKeys.operation_failed)
}
