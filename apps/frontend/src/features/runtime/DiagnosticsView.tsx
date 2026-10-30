import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, localizeAppMessage, translateApp } from '../../i18n'
import { displayPath } from '../../shared/displayPath'

type Props = {
  storagePath: string
  pythonPath: string
  onPythonPathChange: (value: string) => void
  backend: { pid: number; port: number } | null
  backendStatus: string
  busy: boolean
  onStart: () => Promise<void>
  onPing: () => Promise<void>
  onReconnect: () => Promise<void>
  onStop: () => Promise<void>
}

export default function DiagnosticsView({ storagePath, pythonPath, onPythonPathChange, backend, backendStatus, busy, onStart, onPing, onReconnect, onStop }: Props) {
  const { diagnostics } = useDesktop()
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const [logSource, setLogSource] = React.useState<'hermes' | 'client' | 'browser'>('hermes')
  const [logText, setLogText] = React.useState('')
  const [logError, setLogError] = React.useState('')
  const [logLoading, setLogLoading] = React.useState(false)
  const [logRefresh, setLogRefresh] = React.useState(0)

  React.useEffect(() => {
    if (!storagePath) return
    let active = true
    setLogLoading(true)
    setLogError('')
    void diagnostics.readLogs(storagePath, logSource)
      .then(result => { if (active) setLogText(result) })
      .catch(cause => { if (active) { setLogText(''); setLogError(describeError(cause, language)) } })
      .finally(() => { if (active) setLogLoading(false) })
    return () => { active = false }
  }, [diagnostics, language, storagePath, logSource, logRefresh, backend])

  return <section className="settings-panel flat-settings-panel">
    {import.meta.env.DEV && <>
      <small>{t('ui.the.development.version.uses.the.isolation.environment.in.this.product.s.bu')}</small>
      <label>{t('ui.python.absolute.path')}<input value={displayPath(pythonPath)} disabled={!!backend} onChange={event => onPythonPathChange(event.target.value)} /></label>
    </>}
    <div className="diagnostic-log-toolbar">
      <label>{t('ui.log.source')}
        <select value={logSource} onChange={event => setLogSource(event.target.value as 'hermes' | 'client' | 'browser')}>
          <option value="hermes">{t('ui.hermes.logs')}</option>
          <option value="client">{t('ui.client.logs')}</option>
          <option value="browser">{t('ui.browser.logs')}</option>
        </select>
      </label>
      <button type="button" disabled={!storagePath || logLoading} onClick={() => setLogRefresh(value => value + 1)}>{t('ui.refresh.logs')}</button>
    </div>
    {logError && <p role="alert">{t('ui.logs.read.failed.arg', logError)}</p>}
    <pre className="diagnostic-log-output" aria-live="polite">{logLoading ? t('ui.loading.logs') : logText || t('ui.no.logs.yet')}</pre>
    <div className="actions">
      <button disabled={busy || !storagePath || (import.meta.env.DEV && !pythonPath)} onClick={() => void onStart()}>{t('ui.start')}</button>
      <button disabled={busy || !backend} onClick={() => void onPing()}>{t('ui.check.connection')}</button>
      <button disabled={busy || !backend} onClick={() => void onReconnect()}>{t('ui.reconnect.and.restore')}</button>
      <button disabled={busy || !backend} onClick={() => void onStop()}>{t('ui.stop')}</button>
    </div>
    <p role="status">{localizeAppMessage(language, backendStatus)}{backend && t('ui.pid.arg.port.arg', backend.pid, backend.port)}</p>
  </section>
}
