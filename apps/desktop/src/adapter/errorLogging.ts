import { invoke } from '@tauri-apps/api/core'

type ErrorSource = 'frontend_error' | 'unhandled_rejection' | 'react_render_error' | 'quick_input_error'

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.stack || `${cause.name}: ${cause.message}`
  return typeof cause === 'string' ? cause : Object.prototype.toString.call(cause)
}

export function recordClientError(source: ErrorSource, cause: unknown): void {
  void invoke('record_client_error', { source, detail: describe(cause).slice(0, 2048) }).catch(() => {})
}

export function installWindowErrorLogging(): void {
  window.addEventListener('error', event => {
    recordClientError('frontend_error', event.error ?? `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`)
  })
  window.addEventListener('unhandledrejection', event => {
    recordClientError('unhandled_rejection', event.reason)
  })
}
