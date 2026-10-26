import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, changeLanguage, translateApp, localizeAppMessage, type Language } from '../../i18n'
import { displayPath } from '../../shared/displayPath'

type Props = {
  storagePath: string
  onStoragePathChange: (value: string) => void
  storageLocked: boolean
  debugMode: boolean
  debugButtonVisible: boolean
  onDebugModeChange: (value: boolean) => Promise<void>
  pythonPath: string
  onPythonPathChange: (value: string) => void
  backend: { pid: number; port: number } | null
  backendStatus: string
  busy: boolean
  onChooseStoragePath: () => Promise<void>
  onStart: () => Promise<void>
  onPing: () => Promise<void>
  onReconnect: () => Promise<void>
  onStop: () => Promise<void>
}

export default function RuntimeView({ storagePath, onStoragePathChange: setStoragePath, storageLocked, debugMode, debugButtonVisible, onDebugModeChange, pythonPath, onPythonPathChange: setPythonPath, backend, backendStatus, busy, onChooseStoragePath: chooseStoragePath, onStart: startBackend, onPing: pingBackend, onReconnect: reconnectBackend, onStop: stopBackend }: Props) {
  const { diagnostics } = useDesktop()
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const [logSource, setLogSource] = React.useState<'hermes' | 'client' | 'browser'>('hermes')
  const [logText, setLogText] = React.useState('')
  const [logError, setLogError] = React.useState('')
  const [logLoading, setLogLoading] = React.useState(false)
  const [debugOpening, setDebugOpening] = React.useState(false)
  const [debugError, setDebugError] = React.useState('')

  async function toggleDebugMode() {
    setDebugOpening(true)
    setDebugError('')
    try {
      await onDebugModeChange(!debugMode)
    } catch (cause) {
      setDebugError(describeError(cause, language))
    } finally {
      setDebugOpening(false)
    }
  }

  const [logRefresh, setLogRefresh] = React.useState(0)
  React.useEffect(() => {
    if (!debugMode || !storagePath) return
    let active = true
    setLogLoading(true)
    setLogError('')
    void diagnostics.readLogs(storagePath, logSource)
      .then(result => { if (active) setLogText(result) })
      .catch(cause => { if (active) { setLogText(''); setLogError(describeError(cause, language)) } })
      .finally(() => { if (active) setLogLoading(false) })
    return () => { active = false }
  }, [debugMode, storagePath, logSource, logRefresh, backend])

  return <section className="settings-panel flat-settings-panel">
      <h2>{t("ui.runtime.connection")}</h2>
      <label className="system-language-setting">{t('ui.language')}<select value={language} onChange={event => changeLanguage(event.target.value as Language)}><option value="zh-CN">{t('ui.simplified.chinese')}</option><option value="en-US">{t('ui.english')}</option></select></label>
      <p>{import.meta.env.DEV ? t("ui.only.use.the.isolation.environment.prepared.in.this.product.s.build") : t("ui.using.the.bundled.pinned.runtime")}{t("ui.the.storage.directory.creates.product.specific.subdirectories")}</p>
      <label>{t("ui.primary.storage.location")}<input value={displayPath(storagePath)} disabled={storageLocked || !!backend} onChange={event => setStoragePath(event.target.value)} /></label>
      {!storageLocked && <button disabled={busy || !!backend} onClick={() => void chooseStoragePath()}>{t("ui.select.directory")}</button>}
      {storageLocked && <small>{t("ui.the.storage.location.has.been.saved.automatic.relocation.is.not.available.i")}</small>}
      {debugButtonVisible && <button type="button" className="runtime-debug-toggle" aria-pressed={debugMode} disabled={debugOpening} onClick={() => void toggleDebugMode()}>{t('ui.debug')}</button>}
      {debugError && <p role="alert">{t('ui.frontend.console.open.failed.arg', debugError)}</p>}
      {debugMode && <>
        <small role="status">{t('ui.debug.mode.enabled')}</small>
        <details className="runtime-dev-settings">
          <summary>{t("ui.developer.diagnostics")}</summary>
          {import.meta.env.DEV && <>
            <small>{t("ui.the.development.version.uses.the.isolation.environment.in.this.product.s.bu")}</small>
            <label>{t("ui.python.absolute.path")}<input value={displayPath(pythonPath)} disabled={!!backend} onChange={event => setPythonPath(event.target.value)} /></label>
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
        </details>
        <div className="actions">
          <button disabled={busy || !storagePath || (import.meta.env.DEV && !pythonPath)} onClick={() => void startBackend()}>{t("ui.start")}</button>
          <button disabled={busy || !backend} onClick={() => void pingBackend()}>{t("ui.check.connection")}</button>
          <button disabled={busy || !backend} onClick={() => void reconnectBackend()}>{t("ui.reconnect.and.restore")}</button>
          <button disabled={busy || !backend} onClick={() => void stopBackend()}>{t("ui.stop")}</button>
        </div>
        <p role="status">{localizeAppMessage(language, backendStatus)}{backend && t("ui.pid.arg.port.arg", backend.pid, backend.port)}</p>
      </>}
    </section>
}
