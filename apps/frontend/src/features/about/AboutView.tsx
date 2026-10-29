import React from 'react'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'
import type { UpdateStatus } from './useUpdateStatus'

type Tab = 'license' | 'tools' | 'feedback'
const tabs: Tab[] = ['license', 'tools', 'feedback']
export default function AboutView({ updateStatus }: { updateStatus: UpdateStatus }) {
  const language = useLanguage()
  const t = React.useCallback((key: string, ...values: unknown[]) => translateApp(language, key, ...values), [language])
  const [tab, setTab] = React.useState<Tab>('license')
  const [copyState, setCopyState] = React.useState('')
  const { info, infoError, effectiveChannel } = updateStatus
  async function copyEnvironment() {
    if (!info) return
    const lines = [
      `Hermess Agent Desktop ${info.version}`,
      `Official Hermes Agent ${info.hermesVersion}; packaged fork commit ${info.hermesCommit}`,
      `Update channel: ${effectiveChannel}`,
      `Platform: ${navigator.platform}`,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopyState(t('ui.about.copied'))
    } catch {
      setCopyState(t('ui.about.copy.failed'))
    }
  }

  return <section className="settings-panel about-panel">
    <h2>{t('ui.about')}</h2>
    <p>{t('ui.about.intro')}</p>
    <div className="about-tabs" role="tablist" aria-label={t('ui.about.sections')}>
      {tabs.map(item => <button key={item} type="button" role="tab" aria-selected={tab === item}
        className={tab === item ? 'selected' : ''} onClick={() => setTab(item)}>{t(`ui.about.tab.${item}`)}</button>)}
    </div>
    {infoError !== null && <p role="alert">{describeError(infoError, language)}</p>}
    {!info && infoError === null && <p>{t('ui.loading')}</p>}
    {tab === 'license' && <div role="tabpanel" className="about-content">
      <h3>{t('ui.about.product')}</h3>
      <p>{t('ui.about.version')}: <strong>{info?.version ?? '—'}</strong></p>
      <p>{t('ui.about.license.summary')}</p>
      {info && <details><summary>{t('ui.about.license.full')}</summary><pre className="about-license-text">{info.productLicense}</pre></details>}
      <h3>Hermes Agent</h3>
      <p>{t('ui.about.hermes.version')}: <strong>{info?.hermesVersion ?? '—'}</strong></p>
      {info && <p>{t('ui.about.hermes.fork.commit')}: <code className="about-monospace">{info.hermesCommit}</code></p>}
      <p>{t('ui.about.hermes.license')}</p>
      {info && <details><summary>{t('ui.about.hermes.license.full')}</summary><pre className="about-license-text">{info.hermesLicense}</pre></details>}
      <h3>{t('ui.about.third.party')}</h3>
      <p>{t('ui.about.third.party.pending')}</p>
    </div>}
    {tab === 'tools' && <div role="tabpanel" className="about-content">
      <h3>{t('ui.about.tab.tools')}</h3>
      <p>{t('ui.about.tools.explain')}</p>
      <div className="about-card"><strong>Hermess PowerShell Tool</strong><p>{t('ui.about.tools.powershell')}</p></div>
      <p>{t('ui.about.tools.system')}</p>
    </div>}
    {tab === 'feedback' && <div role="tabpanel" className="about-content">
      <h3>{t('ui.about.tab.feedback')}</h3>
      <p>{t('ui.about.feedback.pending')}</p>
      <p>{t('ui.about.feedback.repo')}</p>
      <code className="about-monospace">https://github.com/FirewineXie/hermess-agent-desktop</code>
      <div className="actions"><button type="button" disabled={!info} onClick={() => void copyEnvironment()}>{t('ui.about.copy.environment')}</button></div>
      {copyState && <p role="status">{copyState}</p>}
      <small>{t('ui.about.copy.scope')}</small>
    </div>}


  </section>
}
