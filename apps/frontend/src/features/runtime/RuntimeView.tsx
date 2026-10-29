import React from 'react'
import { useLanguage, changeLanguage, translateApp, type Language } from '../../i18n'
import { displayPath } from '../../shared/displayPath'
import WebviewCacheSettings from './WebviewCacheSettings'

type Props = {
  storagePath: string
  onStoragePathChange: (value: string) => void
  storageLocked: boolean
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

export default function RuntimeView({ storagePath, onStoragePathChange: setStoragePath, storageLocked, backend, busy, onChooseStoragePath: chooseStoragePath }: Props) {
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  return <section className="settings-panel flat-settings-panel">
      <h2>{t("ui.runtime.connection")}</h2>
      <label className="system-language-setting">{t('ui.language')}<select value={language} onChange={event => changeLanguage(event.target.value as Language)}><option value="zh-CN">{t('ui.simplified.chinese')}</option><option value="en-US">{t('ui.english')}</option></select></label>
      <p>{import.meta.env.DEV ? t("ui.only.use.the.isolation.environment.prepared.in.this.product.s.build") : t("ui.using.the.bundled.pinned.runtime")}{t("ui.the.storage.directory.creates.product.specific.subdirectories")}</p>
      <label>{t("ui.primary.storage.location")}<input value={displayPath(storagePath)} disabled={storageLocked || !!backend} onChange={event => setStoragePath(event.target.value)} /></label>
      {!storageLocked && <button disabled={busy || !!backend} onClick={() => void chooseStoragePath()}>{t("ui.select.directory")}</button>}
      {storageLocked && <small>{t("ui.the.storage.location.has.been.saved.automatic.relocation.is.not.available.i")}</small>}
      <WebviewCacheSettings />
    </section>
}
