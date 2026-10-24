import { isDesktopFailure, type DesktopFailureCode } from '@hermess/contracts'
import { translateApp, type Language } from '../i18n'

const messageKeys: Record<DesktopFailureCode, string> = {
  operation_failed: 'ui.desktop.error.operation_failed',
  runtime_unavailable: 'ui.desktop.error.runtime_unavailable',
  connection_lost: 'ui.desktop.error.connection_lost',
  timeout: 'ui.desktop.error.timeout',
  conflict: 'ui.desktop.error.conflict',
  invalid_input: 'ui.desktop.error.invalid_input',
}

export function describeError(error: unknown, language: Language): string {
  if (isDesktopFailure(error)) return translateApp(language, messageKeys[error.code])
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return translateApp(language, messageKeys.operation_failed)
  return translateApp(language, messageKeys.operation_failed)
}
