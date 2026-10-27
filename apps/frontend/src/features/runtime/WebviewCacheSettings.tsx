import React from 'react'
import type { WebviewCacheSettings as CacheSettings } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'

export default function WebviewCacheSettings() {
  const { diagnostics } = useDesktop()
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const [settings, setSettings] = React.useState<CacheSettings | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let active = true
    void diagnostics.getWebviewCacheSettings()
      .then(result => { if (active) setSettings(result) })
      .catch(cause => { if (active) setError(describeError(cause, language)) })
    return () => { active = false }
  }, [diagnostics, language])

  async function change(value: number) {
    setBusy(true)
    setStatus('')
    setError('')
    try {
      await diagnostics.setWebviewCacheSettings(value)
      setSettings(previous => previous && { ...previous, value })
      setStatus(t('ui.webview.cache.saved'))
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setBusy(false)
    }
  }

  async function clearNow() {
    setBusy(true)
    setStatus('')
    setError('')
    try {
      await diagnostics.clearWebviewCacheNow()
      setStatus(t('ui.webview.cache.cleared'))
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setBusy(false)
    }
  }

  return <div className="webview-cache-settings">
    <h3>{t('ui.webview.cache.title')}</h3>
    <p>{t('ui.webview.cache.description')}</p>
    {settings?.strategy === 'unsupported' && <small>{t('ui.webview.cache.unsupported')}</small>}
    {settings && settings.strategy !== 'unsupported' && <>
      <label>{t('ui.webview.cache.policy')}
        <select value={settings.value} disabled={busy} onChange={event => void change(Number(event.target.value))}>
          <option value={0}>{t('ui.webview.cache.off')}</option>
          {settings.strategy === 'size' ? <>
            <option value={256}>256 MiB</option>
            <option value={512}>512 MiB</option>
            <option value={1024}>1 GiB</option>
          </> : <>
            <option value={7}>{t('ui.webview.cache.days', 7)}</option>
            <option value={30}>{t('ui.webview.cache.days', 30)}</option>
            <option value={90}>{t('ui.webview.cache.days', 90)}</option>
          </>}
        </select>
      </label>
      <small>{t(settings.strategy === 'size' ? 'ui.webview.cache.size.hint' : 'ui.webview.cache.time.hint')}</small>
      <button type="button" disabled={busy} onClick={() => void clearNow()}>{t('ui.webview.cache.clear.now')}</button>
      {status && <small role="status">{status}</small>}
    </>}
    {error && <small role="alert">{t('ui.webview.cache.error', error)}</small>}
  </div>
}
