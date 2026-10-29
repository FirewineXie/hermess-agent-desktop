import React from 'react'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'
import { defaultUpdateChannel, type UpdateChannel } from './updateRules'
import type { UpdateStatus } from './useUpdateStatus'

export default function UpdateView({ updateStatus }: { updateStatus: UpdateStatus }) {
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const { info, infoError, effectiveChannel, changeChannel, lookup, lookupError, checking, checkUpdates, candidate, download, downloadError, startDownload } = updateStatus
  const currentDownload = candidate?.asset && download.tagName === candidate.tagName && download.assetId === candidate.asset.id
  const downloading = currentDownload && download.state === 'downloading'

  return <section className="settings-panel about-panel">
    {infoError !== null && <p role="alert">{describeError(infoError, language)}</p>}
    {!info && infoError === null && <p>{t('ui.loading')}</p>}
    <div className="about-content">
      <div className="about-card">
        <p>{t('ui.about.version')}: <strong>{info?.version ?? '—'}</strong>{info && <span className="about-badge">{t(info.version === '0.0.0' ? 'ui.about.version.development' : `ui.about.version.${defaultUpdateChannel(info.version)}`)}</span>}</p>
        <p>{t('ui.about.hermes.version')}: <strong>{info?.hermesVersion ?? '—'}</strong></p>
        <div className="update-channel-actions">
          <label>{t('ui.about.channel.preference')}
            <select value={effectiveChannel} disabled={info?.version === '0.0.0'} onChange={event => changeChannel(event.target.value as UpdateChannel)}>
              <option value="stable">{t('ui.about.channel.stable')}</option>
              <option value="rc">{t('ui.about.channel.rc')}</option>
            </select>
          </label>
          <button className="update-check-button" type="button" disabled={!info || info.version === '0.0.0' || checking || download.state === 'downloading'} onClick={() => void checkUpdates()}>{checking ? t('ui.about.update.checking') : t('ui.about.check.update')}</button>
        </div>
      </div>
      {lookup?.status === 'unavailable' && <p role="status">{t('ui.about.update.unavailable')}</p>}
      {lookup?.status === 'rate_limited' && <p role="status">{t('ui.about.update.rate_limited')}</p>}
      {lookup?.status === 'available' && !candidate && <p role="status">{t('ui.about.update.none')}</p>}
      {candidate?.asset && <div className="about-card">
        <p>{t('ui.about.update.found', candidate.version)}</p>
        <p><code className="about-monospace">{candidate.asset.name}</code> ({(candidate.asset.size / 1024 / 1024).toFixed(1)} MB)</p>
        <button type="button" disabled={download.state === 'downloading' || checking} onClick={() => void startDownload(candidate.tagName, candidate.asset!.id)}>{downloading ? t('ui.about.update.downloading') : t('ui.about.update.download')}</button>
      </div>}
      {downloading && download.total > 0 && <p role="status">{t('ui.about.update.progress', Math.min(100, Math.floor(download.downloaded / download.total * 100)))} ({(download.downloaded / 1024 / 1024).toFixed(1)} / {(download.total / 1024 / 1024).toFixed(1)} MB)</p>}
      {currentDownload && download.state === 'completed' && download.path && <p role="status">{t('ui.about.update.saved', download.path)}</p>}
      {currentDownload && download.state === 'failed' && download.path && <p role="status">{t('ui.about.update.open.failed', download.path)}</p>}
      {lookupError !== null && <p role="alert">{describeError(lookupError, language)}</p>}
      {currentDownload && download.state === 'failed' && download.error && <p role="alert">{describeError(download.error, language)}</p>}
      {downloadError !== null && <p role="alert">{describeError(downloadError, language)}</p>}
      <small>{t('ui.about.update.rule')}</small>
      <small>{t('ui.about.update.manual')}</small>
    </div>
  </section>
}
