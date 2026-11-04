import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage, changeLanguage, translateApp, type Language } from '../../i18n'
import { displayPath } from '../../shared/displayPath'
import WebviewCacheSettings from './WebviewCacheSettings'
import HostSystemStats from './HostSystemStats'
import RuntimeBackup from './RuntimeBackup'
import RuntimeControls from './RuntimeControls'
import { gatewayTopologyRows } from './gatewayTopology'
import './runtime-topology.css'

type Props = {
  page: 'runtime' | 'runtime-status' | 'runtime-backup'
  storagePath: string
  onStoragePathChange: (value: string) => void
  storageLocked: boolean
  pythonPath: string
  onPythonPathChange: (value: string) => void
  backend: { pid: number; port: number } | null
  backendStatus: string
  busy: boolean
  profiles: ProfilesSnapshot | null
  onChooseStoragePath: () => Promise<void>
  onStart: () => Promise<void>
  onPing: () => Promise<void>
  onReconnect: () => Promise<void>
  onRestart: () => Promise<unknown>
  onStop: () => Promise<void>
}

export default function RuntimeView({ page, storagePath, onStoragePathChange: setStoragePath, storageLocked, pythonPath, backend, backendStatus, busy, profiles, onChooseStoragePath: chooseStoragePath, onStart, onPing, onReconnect, onRestart, onStop }: Props) {
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  return <section className="settings-panel flat-settings-panel">
    {page === 'runtime' && <>
      <h2>{t("ui.runtime.connection")}</h2>
      <label className="system-language-setting">{t('ui.language')}<select value={language} onChange={event => changeLanguage(event.target.value as Language)}><option value="zh-CN">{t('ui.simplified.chinese')}</option><option value="en-US">{t('ui.english')}</option></select></label>
      <p>{import.meta.env.DEV ? t("ui.only.use.the.isolation.environment.prepared.in.this.product.s.build") : t("ui.using.the.bundled.pinned.runtime")}{t("ui.the.storage.directory.creates.product.specific.subdirectories")}</p>
      <RuntimeControls language={language} storageReady={Boolean(storagePath)} pythonReady={!import.meta.env.DEV || Boolean(pythonPath)} backend={backend} backendStatus={backendStatus} busy={busy} onStart={onStart} onPing={onPing} onReconnect={onReconnect} onRestart={onRestart} onStop={onStop} />
      {backend && <section className="runtime-topology" aria-labelledby="runtime-topology-title">
        <div><h3 id="runtime-topology-title">{t('ui.runtime.topology')}</h3><span>{profiles?.gateway_mode || '—'}</span></div>
        {gatewayTopologyRows(profiles).map(row => <div className="runtime-topology-row" key={row.owner}><strong>{t('ui.runtime.gateway.owner', row.owner)}</strong><p>{row.served.join(' · ')}</p></div>)}
        {profiles?.reason && <p className="runtime-topology-reason" role="status">{profiles.reason}</p>}
      </section>}
      <label>{t("ui.primary.storage.location")}<input value={displayPath(storagePath)} disabled={storageLocked || !!backend} onChange={event => setStoragePath(event.target.value)} /></label>
      {!storageLocked && <button disabled={busy || !!backend} onClick={() => void chooseStoragePath()}>{t("ui.select.directory")}</button>}
      {storageLocked && <small>{t("ui.the.storage.location.has.been.saved.automatic.relocation.is.not.available.i")}</small>}
      <WebviewCacheSettings />
    </>}
    {page === 'runtime-status' && <HostSystemStats connected={Boolean(backend)} />}
    {page === 'runtime-backup' && <RuntimeBackup connected={Boolean(backend)} />}
    </section>
}
