import React from 'react'
import QRCode from 'qrcode'
import type { ChannelStatus, WhatsAppMode } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useLanguage, translateApp } from '../../i18n'
import { describeError } from '../../app/desktopErrors'
import PairingApproval from './PairingApproval'
import { addTelegramUserId, channelStatusTone, configuredWhatsAppMode, removeTelegramUserId, safeChannelDocsUrl, safeChannelIngressUrl, validateChannelField, type ChannelFieldValidation } from './channelSetupModel'
import { keepFocusInside } from '../extensions/dialogFocus'

type TelegramSetup = {
  id: string; image: string; allowedUserIds: string[]; pendingUserId: string; ready: boolean
}

type WhatsAppSetup = {
  id: string; payload: string; image: string; ready: boolean; mode: WhatsAppMode; allowedUsers: string;
  accountId?: string | null; accountName?: string | null; accountPhone?: string | null
}

export default function OtherChannels({ rows, profile, busy, onRefresh, onRestart, statusText }: {
  rows: ChannelStatus[]
  profile: string
  busy: boolean
  onRefresh: () => Promise<void>
  onRestart: () => Promise<boolean>
  statusText: (row: ChannelStatus) => string
}) {
  const { channels } = useDesktop()
  const language = useLanguage()
  const t = (key: string, ...args: unknown[]) => translateApp(language, key, ...args)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [cleared, setCleared] = React.useState<string[]>([])
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [working, setWorking] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [restartNeeded, setRestartNeeded] = React.useState(false)
  const [telegram, setTelegram] = React.useState<TelegramSetup | null>(null)
  const [vendorQr, setVendorQr] = React.useState<{ id: string; platform: 'dingtalk' | 'wecom' | 'qqbot'; image: string; interval: number; ready: boolean } | null>(null)
  const whatsappStatus = rows.find(row => row.id === 'whatsapp')
  const [whatsappMode, setWhatsAppMode] = React.useState<WhatsAppMode>(() => configuredWhatsAppMode(whatsappStatus?.whatsapp_setup?.mode))
  const [whatsappAllowedUsers, setWhatsAppAllowedUsers] = React.useState('')
  const [whatsapp, setWhatsApp] = React.useState<WhatsAppSetup | null>(null)
  const [confirmWhatsAppRepair, setConfirmWhatsAppRepair] = React.useState(false)
  const activeSetups = React.useRef<{ telegram?: string; vendor?: string; whatsapp?: string }>({})
  const dialogRef = React.useRef<HTMLDivElement | HTMLFormElement>(null)
  const dialogOpenerRef = React.useRef<HTMLElement | null>(null)
  const dialogWasOpen = React.useRef(false)
  const scope = { kind: 'profile' as const, profile }
  const copyIngressUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setMessage(t('ui.channels.ingress.copied'))
    } catch {
      setMessage(t('ui.channels.ingress.copy.failed'))
    }
  }
  const selected = rows.find(row => row.id === editing)
  const dialogOpen = Boolean(selected || telegram || vendorQr || whatsapp)

  const rememberDialogOpener = () => {
    dialogOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  React.useEffect(() => {
    if (!whatsapp) setWhatsAppMode(configuredWhatsAppMode(whatsappStatus?.whatsapp_setup?.mode))
  }, [profile, whatsappStatus?.whatsapp_setup?.mode, whatsapp])

  React.useEffect(() => {
    if (dialogOpen) {
      dialogWasOpen.current = true
      window.requestAnimationFrame(() => dialogRef.current?.focus())
    } else if (dialogWasOpen.current) {
      dialogWasOpen.current = false
      dialogOpenerRef.current?.focus()
      dialogOpenerRef.current = null
    }
  }, [dialogOpen, editing, telegram?.id, vendorQr?.id, whatsapp?.id])

  React.useEffect(() => {
    activeSetups.current = {
      telegram: telegram?.id,
      vendor: vendorQr?.id,
      whatsapp: whatsapp?.id,
    }
  }, [telegram?.id, vendorQr?.id, whatsapp?.id])

  React.useEffect(() => () => {
    const active = activeSetups.current
    if (active.telegram) void channels.telegramCancel(scope, active.telegram).catch(() => {})
    if (active.vendor) void channels.vendorQrCancel(scope, active.vendor).catch(() => {})
    if (active.whatsapp) void channels.whatsappCancel(scope, active.whatsapp).catch(() => {})
  }, [channels, profile])

  React.useEffect(() => {
    if (!telegram || telegram.ready) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void channels.telegramPoll(scope, telegram.id).then(result => {
        if (cancelled) return
        if (result.status === 'expired') { setTelegram(null); setMessage(t('ui.channels.expired')) }
        else if (result.status === 'ready') setTelegram(current => {
          if (!current) return current
          const owner = result.owner_user_id || ''
          const allowedUserIds = owner && !current.allowedUserIds.includes(owner) ? [owner, ...current.allowedUserIds] : current.allowedUserIds
          return { ...current, ready: true, allowedUserIds }
        })
        else setTelegram(current => current && { ...current })
      }).catch(cause => { if (!cancelled) { setMessage(t('ui.channels.failed.arg', describeError(cause, language))); setTelegram(current => current && { ...current }) } })
    }, 3000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [telegram, channels, profile, language])

  React.useEffect(() => {
    if (!vendorQr || vendorQr.ready) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void channels.vendorQrPoll(scope, vendorQr.id).then(result => {
        if (cancelled) return
        if (result.status === 'expired') { setVendorQr(null); setMessage(t('ui.channels.expired')) }
        else if (result.status === 'ready') setVendorQr(current => current && { ...current, ready: true })
        else setVendorQr(current => current && { ...current })
      }).catch(cause => { if (!cancelled) { setMessage(t('ui.channels.failed.arg', describeError(cause, language))); setVendorQr(current => current && { ...current }) } })
    }, vendorQr.interval * 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [vendorQr, channels, profile, language])

  React.useEffect(() => {
    if (!whatsapp || whatsapp.ready) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void channels.whatsappPoll(scope, whatsapp.id).then(async result => {
        if (cancelled) return
        if (result.status === 'expired' || result.status === 'failed') {
          setWhatsApp(null)
          setMessage(t(result.status === 'expired' ? 'ui.channels.expired' : 'ui.channels.status.failed'))
        } else if (result.status === 'ready') {
          setWhatsApp(current => current && {
            ...current,
            ready: true,
            mode: result.mode || current.mode,
            allowedUsers: result.allowed_users ?? current.allowedUsers,
            accountId: result.account_id ?? current.accountId,
            accountName: result.account_name ?? current.accountName,
            accountPhone: result.account_phone ?? current.accountPhone,
          })
        } else if (result.qr_payload && result.qr_payload !== whatsapp.payload) {
          const image = await QRCode.toDataURL(result.qr_payload, { width: 260, margin: 2 })
          if (!cancelled) setWhatsApp(current => current && { ...current, payload: result.qr_payload || '', image })
        } else setWhatsApp(current => current && { ...current })
      }).catch(cause => { if (!cancelled) { setMessage(t('ui.channels.failed.arg', describeError(cause, language))); setWhatsApp(current => current && { ...current }) } })
    }, 3000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [whatsapp, channels, profile, language])

  async function startWhatsApp(resetSession = false) {
    rememberDialogOpener()
    setConfirmWhatsAppRepair(false)
    await run(async () => {
      const setup = await channels.whatsappStart(scope, {
        mode: whatsappMode,
        allowedUsers: whatsappAllowedUsers,
        resetSession,
      })
      const payload = setup.qr_payload || ''
      const image = payload ? await QRCode.toDataURL(payload, { width: 260, margin: 2 }) : ''
      setWhatsApp({
        id: setup.id, payload, image, ready: setup.status === 'ready',
        mode: setup.mode, allowedUsers: setup.allowed_users,
        accountId: setup.account_id, accountName: setup.account_name, accountPhone: setup.account_phone,
      })
    })
  }

  async function cancelWhatsApp() {
    const current = whatsapp
    setWhatsApp(null)
    setConfirmWhatsAppRepair(false)
    if (current) await channels.whatsappCancel(scope, current.id).catch(() => {})
  }

  async function applyWhatsApp() {
    if (!whatsapp) return
    await run(async () => {
      await channels.whatsappApply(scope, whatsapp.id, {
        mode: whatsapp.mode,
        allowedUsers: whatsapp.allowedUsers,
      })
      setWhatsApp(null)
      setRestartNeeded(true)
      setMessage(t('ui.channels.saved.restart'))
    })
  }

  async function startVendorQr(platform: 'dingtalk' | 'wecom' | 'qqbot') {
    rememberDialogOpener()
    await run(async () => {
      const setup = await channels.vendorQrStart(scope, platform)
      const image = await QRCode.toDataURL(setup.url, { width: 260, margin: 2 })
      setVendorQr({ id: setup.id, platform, image, interval: setup.poll_interval, ready: false })
    })
  }

  async function cancelVendorQr() {
    const current = vendorQr
    setVendorQr(null)
    if (current) await channels.vendorQrCancel(scope, current.id).catch(() => {})
  }

  async function applyVendorQr() {
    if (!vendorQr) return
    await run(async () => {
      await channels.vendorQrApply(scope, vendorQr.id)
      setVendorQr(null)
      setRestartNeeded(true)
      setMessage(t('ui.channels.saved.restart'))
    })
  }

  async function startTelegram() {
    rememberDialogOpener()
    await run(async () => {
      const setup = await channels.telegramStart(scope)
      const image = await QRCode.toDataURL(setup.url, { width: 260, margin: 2 })
      setTelegram({ id: setup.id, image, allowedUserIds: [], pendingUserId: '', ready: false })
    })
  }

  async function cancelTelegram() {
    const current = telegram
    setTelegram(null)
    if (current) await channels.telegramCancel(scope, current.id).catch(() => {})
  }

  async function applyTelegram() {
    if (!telegram) return
    await run(async () => {
      await channels.telegramApply(scope, telegram.id, telegram.allowedUserIds)
      setTelegram(null)
      setRestartNeeded(true)
      setMessage(t('ui.channels.saved.restart'))
    })
  }

  function addTelegramUser() {
    if (!telegram) return
    const values = addTelegramUserId(telegram.allowedUserIds, telegram.pendingUserId)
    if (!values) { setMessage(t('ui.channels.telegram.id.invalid')); return }
    setMessage('')
    setTelegram({ ...telegram, allowedUserIds: values, pendingUserId: '' })
  }

  function open(row: ChannelStatus) {
    rememberDialogOpener()
    setEditing(row.id)
    setDraft(Object.fromEntries((row.fields || []).filter(field => field.is_list).map(field => [field.key, field.value || ''])))
    setCleared([])
    setFieldErrors({})
    setMessage('')
  }

  function closeDialog() {
    if (working) return
    if (selected) setEditing(null)
    else if (telegram) void cancelTelegram()
    else if (vendorQr) void cancelVendorQr()
    else if (whatsapp) void cancelWhatsApp()
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialog()
      return
    }
    keepFocusInside(event)
  }

  function fieldErrorText(error: ChannelFieldValidation): string {
    if (error.kind === 'telegram-token') return t('ui.channels.validation.telegram.token')
    if (error.kind === 'telegram-user') return t('ui.channels.validation.telegram.user', error.value)
    if (error.kind === 'slack-token') return t('ui.channels.validation.slack.token', error.prefix)
    return t('ui.channels.validation.slack.user', error.value)
  }

  async function run(action: () => Promise<void>) {
    setWorking(true)
    setMessage('')
    try { await action(); await onRefresh() }
    catch (cause) { setMessage(t('ui.channels.failed.arg', describeError(cause, language))) }
    finally { setWorking(false) }
  }

  async function save() {
    if (!selected) return
    const env: Record<string, string> = {}
    for (const field of selected.fields || []) {
      const value = (draft[field.key] || '').trim()
      if (cleared.includes(field.key) || !value) continue
      if (!field.is_list || value !== (field.value || '')) env[field.key] = value
    }
    const clear_env = [...cleared]
    for (const field of selected.fields || []) {
      if (field.is_list && field.is_set && !cleared.includes(field.key)
        && !(draft[field.key] || '').trim()) clear_env.push(field.key)
    }
    const extraRequired = selected.id === 'yuanbao' ? ['YUANBAO_APP_ID', 'YUANBAO_APP_SECRET'] : []
    const hasConfiguration = selected.id === 'whatsapp' ? selected.configured
      : (selected.fields || []).some(field => !!env[field.key] || (field.is_set && !clear_env.includes(field.key)))
    const complete = hasConfiguration
      && (selected.fields || []).every(field => !(field.required || extraRequired.includes(field.key))
        || (!!env[field.key] || (field.is_set && !clear_env.includes(field.key))))
    if (!Object.keys(env).length && !clear_env.length) {
      setMessage(t('ui.channels.validation.no.changes'))
      return
    }
    const missing = (selected.fields || []).find(field => (field.required || extraRequired.includes(field.key))
      && !env[field.key] && !(field.is_set && !clear_env.includes(field.key)))
    if (missing) {
      setMessage(t('ui.channels.validation.required', missing.prompt || missing.key))
      return
    }
    const nextFieldErrors: Record<string, string> = {}
    for (const field of selected.fields || []) {
      const error = validateChannelField(field.key, draft[field.key] || '')
      if (error) nextFieldErrors[field.key] = fieldErrorText(error)
    }
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length) {
      setMessage(t('ui.channels.validation.fix'))
      return
    }
    await run(async () => {
      const result = await channels.save(scope, selected.id, { env, clear_env, enabled: complete })
      setEditing(null)
      if (!result.hot_served) setRestartNeeded(true)
      setMessage(t(complete ? 'ui.channels.saved.restart' : 'ui.channels.saved.incomplete'))
    })
  }

  async function toggle(row: ChannelStatus) {
    if (row.id === 'whatsapp' && !row.enabled && !row.configured) { await startWhatsApp(); return }
    if (!row.enabled && !row.configured) { open(row); return }
    await run(async () => {
      const result = await channels.save(scope, row.id, { env: {}, clear_env: [], enabled: !row.enabled })
      if (!result.hot_served) setRestartNeeded(true)
      setMessage(t('ui.channels.saved.restart'))
    })
  }

  async function test(row: ChannelStatus) {
    await run(async () => {
      const result = await channels.test(scope, row.id)
      const denied = result.auth_posture === 'deny_all'
      setMessage(`${row.name}: ${t(denied ? 'ui.channels.test.no.access' : result.ok ? 'ui.channels.test.connected' : 'ui.channels.test.failed')} (${result.state})`)
    })
  }

  return <section className="other-channels" aria-labelledby="other-channels-title">
    <div className="channels-section-heading"><div><h3 id="other-channels-title">{t('ui.channels.other')}</h3><p>{t('ui.channels.other.manage')}</p></div><span>{rows.length}</span></div>
    <div className="channel-list">
      {rows.map(row => {
        const docsUrl = safeChannelDocsUrl(row.docs_url)
        const ingressUrl = safeChannelIngressUrl(row.ingress_url)
        return <article className="channel-row" key={row.id}>
        <div className="channel-logo" aria-hidden="true">{(row.name || row.id).slice(0, 1).toUpperCase()}</div>
        <div className="channel-row-main">
        <div className="channel-title-line"><h4>{row.name || row.id}</h4><span className={`channel-status-badge is-${channelStatusTone(row.state)}`}>{statusText(row)}</span></div>
        {row.description && <p className="other-channel-description">{row.description}</p>}
        {(docsUrl || ingressUrl) && <div className="other-channel-metadata">
          {docsUrl && <a href={docsUrl} target="_blank" rel="noreferrer">{t('ui.channels.docs')} ↗</a>}
          {ingressUrl && <div className="other-channel-ingress"><code title={ingressUrl}>{ingressUrl}</code><button type="button" onClick={() => void copyIngressUrl(ingressUrl)}>{t('ui.channels.ingress.copy')}</button></div>}
        </div>}
        {!row.supported && <small className="channel-error">{t('ui.channels.unsupported.platform')}</small>}
        {(row.error_message || row.error_code) && <small className="channel-error" role="alert">{row.error_message || row.error_code}</small>}
        {row.id === 'whatsapp' && <div className="channel-whatsapp-options">
          <span>{t('ui.channels.whatsapp.mode')}</span>
          <div className="channel-mode-buttons">
            <button type="button" aria-pressed={whatsappMode === 'bot'} disabled={busy || working || !!whatsapp} onClick={() => setWhatsAppMode('bot')}>{t('ui.channels.whatsapp.mode.bot')}</button>
            <button type="button" aria-pressed={whatsappMode === 'self-chat'} disabled={busy || working || !!whatsapp} onClick={() => setWhatsAppMode('self-chat')}>{t('ui.channels.whatsapp.mode.self')}</button>
          </div>
          <label>{t('ui.channels.whatsapp.allowed')}<input value={whatsappAllowedUsers} disabled={busy || working || !!whatsapp} placeholder="15551234567,15557654321" onChange={event => setWhatsAppAllowedUsers(event.target.value)} /></label>
          <small>{row.whatsapp_setup?.allowed_users_set && !whatsappAllowedUsers.trim() ? t('ui.channels.whatsapp.allowed.keep') : t('ui.channels.whatsapp.allowed.help')}</small>
        </div>}
        {row.id === 'whatsapp' && confirmWhatsAppRepair && <div className="channel-inline-confirm" role="alertdialog" aria-label={t('ui.channels.whatsapp.repair')}>
          <strong>{t('ui.channels.whatsapp.repair.confirm.title')}</strong>
          <p>{t('ui.channels.whatsapp.repair.confirm.body')}</p>
          <div><button disabled={busy || working} onClick={() => void startWhatsApp(true)}>{t('ui.channels.whatsapp.repair.confirm')}</button><button disabled={working} onClick={() => setConfirmWhatsAppRepair(false)}>{t('ui.channels.cancel')}</button></div>
        </div>}
        {row.configured && row.supported && <PairingApproval platform={row.id} profile={profile} disabled={busy || working} />}
        </div>
        <div className="channel-row-actions">
          {row.id === 'telegram' && <button className="channel-primary-action" disabled={busy || working} onClick={() => void startTelegram()}>{t('ui.channels.scan')}</button>}
          {row.id === 'whatsapp' && <button className="channel-primary-action" disabled={busy || working} onClick={() => void startWhatsApp(false)}>{t(row.configured ? 'ui.channels.whatsapp.use.existing' : 'ui.channels.scan')}</button>}
          {(['dingtalk', 'wecom', 'qqbot'].includes(row.id)) && <button className="channel-primary-action" disabled={busy || working} onClick={() => void startVendorQr(row.id as 'dingtalk' | 'wecom' | 'qqbot')}>{t('ui.channels.scan')}</button>}
          <button disabled={busy || working || !row.supported || !row.fields?.length} onClick={() => open(row)}>{t('ui.channels.configure')}</button>
          <button disabled={busy || working} onClick={() => void test(row)}>{t('ui.channels.test')}</button>
          <button className={row.enabled ? 'channel-danger-action' : ''} disabled={busy || working || (!row.supported && !row.enabled)} onClick={() => void toggle(row)}>{t(row.enabled ? 'ui.channels.disable' : 'ui.channels.enable')}</button>
          {row.id === 'whatsapp' && row.configured && <button disabled={busy || working} onClick={() => setConfirmWhatsAppRepair(true)}>{t('ui.channels.whatsapp.repair')}</button>}
        </div>
      </article>})}
    </div>
    {selected && <div className="channel-qr-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}>
      <form className="channel-qr channel-config" ref={dialogRef as React.RefObject<HTMLFormElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="channel-config-title" onKeyDown={handleDialogKeyDown} onSubmit={event => { event.preventDefault(); void save() }}>
        <h3 id="channel-config-title">{selected.name}</h3>
        {(selected.fields || []).map(field => <label key={field.key} className="channel-config-field">
          <span>{field.prompt || field.key}{field.required ? ' *' : ''}</span>
          <input type={field.is_password ? 'password' : 'text'} autoComplete="off" value={draft[field.key] || ''} aria-invalid={!!fieldErrors[field.key]}
            placeholder={field.is_set && !field.is_list ? t('ui.channels.keep.existing') : ''}
            onChange={event => { setDraft(current => ({ ...current, [field.key]: event.target.value })); setFieldErrors(current => { const next = { ...current }; delete next[field.key]; return next }) }} />
          {fieldErrors[field.key] && <small className="channel-field-error" role="alert">{fieldErrors[field.key]}</small>}
          {field.help && <small>{field.help}</small>}
          {field.is_set && <span><input type="checkbox" checked={cleared.includes(field.key)} onChange={event => setCleared(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{t('ui.channels.clear.field')}</span>}
        </label>)}
        <div><button type="submit" disabled={working}>{t('ui.save')}</button><button type="button" disabled={working} onClick={() => setEditing(null)}>{t('ui.channels.cancel')}</button></div>
      </form>
    </div>}
    {telegram && <div className="channel-qr-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}>
      <div className="channel-qr" ref={dialogRef as React.RefObject<HTMLDivElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="telegram-setup-title" onKeyDown={handleDialogKeyDown}>
        <h3 id="telegram-setup-title">Telegram</h3>
        <img src={telegram.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />
        <p>{t('ui.channels.pairing.once')}</p>
        <p>{t(telegram.ready ? 'ui.channels.telegram.ready' : 'ui.channels.waiting')}</p>
        {message && <p role="alert">{message}</p>}
        {telegram.ready && <div className="channel-telegram-users">
          <label>{t('ui.channels.telegram.user.id')}<span><input value={telegram.pendingUserId} inputMode="numeric" onChange={event => setTelegram(current => current && { ...current, pendingUserId: event.target.value })} /><button type="button" disabled={working} onClick={addTelegramUser}>{t('ui.channels.telegram.user.add')}</button></span></label>
          {telegram.allowedUserIds.length > 0 && <ul>{telegram.allowedUserIds.map(userId => <li key={userId}><code>{userId}</code><button type="button" disabled={working} aria-label={`${t('ui.channels.telegram.user.remove')} ${userId}`} onClick={() => setTelegram(current => current && { ...current, allowedUserIds: removeTelegramUserId(current.allowedUserIds, userId) })}>{t('ui.channels.telegram.user.remove')}</button></li>)}</ul>}
        </div>}
        {telegram.ready && <button disabled={working || telegram.allowedUserIds.length === 0} onClick={() => void applyTelegram()}>{t('ui.channels.telegram.complete')}</button>}
        <button disabled={working} onClick={() => void cancelTelegram()}>{t('ui.channels.cancel')}</button>
      </div>
    </div>}
    {vendorQr && <div className="channel-qr-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}>
      <div className="channel-qr" ref={dialogRef as React.RefObject<HTMLDivElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="vendor-qr-title" onKeyDown={handleDialogKeyDown}>
        <h3 id="vendor-qr-title">{vendorQr.platform === 'wecom' ? 'WeCom' : vendorQr.platform === 'qqbot' ? 'QQ Bot' : 'DingTalk'}</h3>
        <img src={vendorQr.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />
        <p>{t('ui.channels.pairing.once')}</p>
        <p>{t(vendorQr.ready ? 'ui.channels.vendor.ready' : 'ui.channels.waiting')}</p>
        {message && <p role="alert">{message}</p>}
        {vendorQr.ready && <button disabled={working} onClick={() => void applyVendorQr()}>{t('ui.channels.telegram.complete')}</button>}
        <button disabled={working} onClick={() => void cancelVendorQr()}>{t('ui.channels.cancel')}</button>
      </div>
    </div>}
    {whatsapp && <div className="channel-qr-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}>
      <div className="channel-qr" ref={dialogRef as React.RefObject<HTMLDivElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="whatsapp-qr-title" onKeyDown={handleDialogKeyDown}>
        <h3 id="whatsapp-qr-title">WhatsApp</h3>
        {whatsapp.image && <img src={whatsapp.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />}
        <p>{t('ui.channels.pairing.once')}</p>
        <p>{t(whatsapp.ready ? 'ui.channels.vendor.ready' : whatsapp.image ? 'ui.channels.waiting' : 'ui.channels.whatsapp.preparing')}</p>
        <div className="channel-whatsapp-dialog-options">
          <span>{t('ui.channels.whatsapp.mode')}</span>
          <div className="channel-mode-buttons"><button type="button" aria-pressed={whatsapp.mode === 'bot'} disabled={working} onClick={() => setWhatsApp(current => current && { ...current, mode: 'bot' })}>{t('ui.channels.whatsapp.mode.bot')}</button><button type="button" aria-pressed={whatsapp.mode === 'self-chat'} disabled={working} onClick={() => setWhatsApp(current => current && { ...current, mode: 'self-chat' })}>{t('ui.channels.whatsapp.mode.self')}</button></div>
          <label>{t('ui.channels.whatsapp.allowed')}<input value={whatsapp.allowedUsers} disabled={working} placeholder="15551234567,15557654321" onChange={event => setWhatsApp(current => current && { ...current, allowedUsers: event.target.value })} /></label>
          {!whatsapp.allowedUsers.trim() && whatsappStatus?.whatsapp_setup?.allowed_users_set && <small>{t('ui.channels.whatsapp.allowed.keep')}</small>}
        </div>
        {whatsapp.ready && (whatsapp.accountPhone || whatsapp.accountName || whatsapp.accountId) && <p className="channel-linked-account"><strong>{t('ui.channels.whatsapp.account')}：</strong>{whatsapp.accountPhone ? `+${whatsapp.accountPhone}` : whatsapp.accountName || whatsapp.accountId}</p>}
        {whatsapp.ready && <small>{t(whatsapp.mode === 'self-chat' ? 'ui.channels.whatsapp.self.help' : 'ui.channels.whatsapp.bot.help')}</small>}
        {message && <p role="alert">{message}</p>}
        {whatsapp.ready && <button disabled={working} onClick={() => void applyWhatsApp()}>{t('ui.channels.telegram.complete')}</button>}
        <button disabled={working} onClick={() => void cancelWhatsApp()}>{t('ui.channels.cancel')}</button>
      </div>
    </div>}
    {message && <p role="status">{message}</p>}
    {restartNeeded && <button disabled={busy || working} onClick={() => void run(async () => { if (await onRestart()) { setRestartNeeded(false); setMessage(t('ui.channels.connected')) } })}>{t('ui.channels.restart.retry')}</button>}
  </section>
}
