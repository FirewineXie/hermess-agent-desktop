import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'

export default function PairingApproval({ platform, profile, disabled }: { platform: string; profile: string; disabled: boolean }) {
  const { channels } = useDesktop()
  const language = useLanguage()
  const t = (key: string, ...args: unknown[]) => translateApp(language, key, ...args)
  const [code, setCode] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  async function approve(event: React.FormEvent) {
    event.preventDefault()
    if (disabled || submitting) return
    const normalized = code.replace(/\s/g, '').toUpperCase()
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(normalized)) {
      setStatus(t('ui.channels.pairing.invalid'))
      return
    }
    setSubmitting(true)
    setStatus('')
    try {
      await channels.approvePairing({ kind: 'profile', profile }, platform, normalized)
      setCode('')
      setStatus(t('ui.channels.pairing.approved'))
    } catch (cause) {
      setStatus(t('ui.channels.pairing.failed', describeError(cause, language)))
    } finally { setSubmitting(false) }
  }

  return <details className="channel-pairing">
    <summary>{t('ui.channels.pairing.expand')}</summary>
    <form onSubmit={event => void approve(event)}>
      <label htmlFor={`pairing-${platform}`}>{t('ui.channels.pairing.label')}</label>
      <p>{t('ui.channels.pairing.profile', profile)}</p>
      <div>
        <input id={`pairing-${platform}`} value={code} maxLength={20} autoComplete="off"
          onChange={event => { setCode(event.target.value); setStatus('') }} placeholder={t('ui.channels.pairing.placeholder')} />
        <button type="submit" disabled={disabled || submitting || !code.trim()}>{t('ui.channels.pairing.approve')}</button>
      </div>
      {status && <p role="status">{status}</p>}
    </form>
  </details>
}
