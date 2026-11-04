import React from 'react'
import { localizeAppMessage, translateApp, type Language } from '../../i18n'
import './runtime-controls.css'

type Props = {
  language: Language
  storageReady: boolean
  pythonReady: boolean
  backend: { pid: number; port: number } | null
  backendStatus: string
  busy: boolean
  onStart: () => Promise<void>
  onPing: () => Promise<void>
  onReconnect: () => Promise<void>
  onRestart: () => Promise<unknown>
  onStop: () => Promise<void>
}

export default function RuntimeControls({
  language, storageReady, pythonReady, backend, backendStatus, busy,
  onStart, onPing, onReconnect, onRestart, onStop,
}: Props) {
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const stop = () => {
    if (!window.confirm(t('ui.runtime.stop.confirm'))) return
    void onStop()
  }

  return <section className="runtime-controls" aria-labelledby="runtime-controls-title">
    <header>
      <div>
        <h3 id="runtime-controls-title">{t('ui.runtime.control.title')}</h3>
        <p>{t('ui.runtime.control.description')}</p>
      </div>
      <span className={backend ? 'connected' : 'stopped'}>{backend ? t('ui.runtime.connected') : t('ui.runtime.not.started')}</span>
    </header>
    <div className="runtime-control-status" role="status" aria-live="polite">
      <strong>{localizeAppMessage(language, backendStatus)}</strong>
      {backend && <small>{t('ui.pid.arg.port.arg', backend.pid, backend.port)}</small>}
    </div>
    <div className="runtime-control-actions">
      {!backend
        ? <button type="button" disabled={busy || !storageReady || !pythonReady} onClick={() => void onStart()}>{t('ui.start')}</button>
        : <>
          <button type="button" disabled={busy} onClick={() => void onPing()}>{t('ui.check.connection')}</button>
          <button type="button" disabled={busy} onClick={() => void onReconnect()}>{t('ui.reconnect.and.restore')}</button>
          <button type="button" disabled={busy} onClick={() => void onRestart()}>{t('ui.optional.runtime.tools.restart')}</button>
          <button className="danger" type="button" disabled={busy} onClick={stop}>{t('ui.stop')}</button>
        </>}
    </div>
    {!backend && (!storageReady || !pythonReady) && <small>{t('ui.runtime.start.requirements')}</small>}
  </section>
}
