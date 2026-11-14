import React from 'react'
import type { WebAccessAction, WebAccessSettings as Settings, WebAccessStatus } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'

type Props = {
  gatewayPid?: number
  busy: boolean
  onEnable: () => Promise<WebAccessStatus | null>
}

export default function WebAccessSettings({ gatewayPid, busy, onEnable }: Props) {
  const { runtime, nativeFiles } = useDesktop()
  const language = useLanguage()
  const t = (key: string) => translateApp(language, `ui.web.access.${key}`)
  const [status, setStatus] = React.useState<WebAccessStatus | null>(null)
  const [draft, setDraft] = React.useState<Settings | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const dirty = status && draft && Object.keys(draft).some(key => {
    const field = key as keyof Settings
    return draft[field] !== status.settings[field]
  })

  React.useEffect(() => {
    let current = true
    void runtime.webAccess({ action: 'status' }).then(next => {
      if (!current) return
      setStatus(previous => next.enabled && previous?.enabled ? { ...next, link: previous.link } : next)
      setDraft(previous => previous ?? next.settings)
    }).catch(cause => { if (current) setError(describeError(cause, language)) })
    return () => { current = false }
  }, [runtime, gatewayPid, language])

  async function change(action: WebAccessAction) {
    setPending(true)
    setError('')
    setCopied(false)
    try {
      const next = action.action === 'enable' ? await onEnable() : await runtime.webAccess(action)
      if (next) {
        setStatus(next)
        if (action.action === 'save') setDraft(next.settings)
      }
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setPending(false)
    }
  }

  function edit(field: keyof Settings, value: string) {
    setDraft(previous => previous && { ...previous, [field]: value })
  }

  async function choose(field: 'certificatePath' | 'privateKeyPath', title: string) {
    try {
      const selected = await nativeFiles.choose({ multiple: false, directory: false, title })
      if (typeof selected === 'string') edit(field, selected)
    } catch (cause) {
      setError(describeError(cause, language))
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError(t('copy.failed'))
    }
  }

  const disabled = busy || pending
  const link = status?.link
  return <section className="settings-panel flat-settings-panel" aria-labelledby="web-access-title">
    <h2 id="web-access-title">{t('title')}</h2>
    <p>{t('description')}</p>
    {status && draft && <>
      <small role="status">{t(status.enabled ? 'enabled' : 'disabled')}</small>
      <label>{t('origin')}<input type="url" placeholder="https://hermess.example:8443" value={draft.origin} disabled={disabled || status.enabled} onChange={event => edit('origin', event.target.value)} /></label>
      <label>{t('bind.ip')}<input value={draft.listenIp} disabled={disabled || status.enabled} onChange={event => edit('listenIp', event.target.value)} /></label>
      <small>{t('bind.hint')}</small>
      <button type="button" disabled={disabled || status.enabled || !draft.origin.trim()} onClick={() => void change({
        action: 'save', settings: { ...draft, certificatePath: '', privateKeyPath: '' },
      })}>{t('certificate.generate')}</button>
      {status.settings.certificatePath && <small>{t('certificate.configured')}</small>}
      <small>{t('certificate.hint')}</small>
      <details>
        <summary>{t('certificate.import')}</summary>
        <label>{t('certificate')}<input value={draft.certificatePath} disabled={disabled || status.enabled} onChange={event => edit('certificatePath', event.target.value)} /></label>
        <button type="button" disabled={disabled || status.enabled} onClick={() => void choose('certificatePath', t('certificate'))}>{t('choose.certificate')}</button>
        <label>{t('private.key')}<input value={draft.privateKeyPath} disabled={disabled || status.enabled} onChange={event => edit('privateKeyPath', event.target.value)} /></label>
        <button type="button" disabled={disabled || status.enabled} onClick={() => void choose('privateKeyPath', t('private.key'))}>{t('choose.key')}</button>
      </details>
      {status.enabled ? <>
        <button type="button" disabled={disabled} onClick={() => void change({ action: 'disable' })}>{t('disable')}</button>
        <button type="button" disabled={disabled} onClick={() => void change({ action: 'launch' })}>{t('launch')}</button>
      </> : <>
        <button type="button" disabled={disabled || !dirty} onClick={() => void change({ action: 'save', settings: draft })}>{t('save')}</button>
        <button type="button" disabled={disabled || !!dirty || !status.settings.origin || !status.settings.certificatePath || !gatewayPid} onClick={() => void change({ action: 'enable' })}>{t('enable')}</button>
        <small>{t(gatewayPid ? 'restart.hint' : 'gateway.required')}</small>
      </>}
      {link && <>
        <label>{t('link')}<input readOnly value={link} onFocus={event => event.target.select()} /></label>
        <button type="button" onClick={() => void copy(link)}>{t(copied ? 'copied' : 'copy')}</button>
        <small>{t('link.hint')}</small>
      </>}
    </>}
    {error && <small role="alert">{error}</small>}
  </section>
}
