import React from 'react'
import QRCode from 'qrcode'
import type { ChannelStatus } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useLanguage, translateApp } from '../../i18n'
import { describeError } from '../../app/desktopErrors'
import PairingApproval from './PairingApproval'

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
  const [working, setWorking] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [restartNeeded, setRestartNeeded] = React.useState(false)
  const [telegram, setTelegram] = React.useState<{ id: string; image: string; ownerUserId: string; ready: boolean } | null>(null)
  const [vendorQr, setVendorQr] = React.useState<{ id: string; platform: 'dingtalk' | 'wecom' | 'qqbot'; image: string; interval: number; ready: boolean } | null>(null)
  const [whatsapp, setWhatsApp] = React.useState<{ id: string; payload: string; image: string; ready: boolean } | null>(null)
  const scope = { kind: 'profile' as const, profile }
  const selected = rows.find(row => row.id === editing)

  React.useEffect(() => {
    if (!telegram || telegram.ready) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void channels.telegramPoll(scope, telegram.id).then(result => {
        if (cancelled) return
        if (result.status === 'expired') { setTelegram(null); setMessage(t('ui.channels.expired')) }
        else if (result.status === 'ready') setTelegram(current => current && { ...current, ready: true, ownerUserId: result.owner_user_id || '' })
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
          setWhatsApp(current => current && { ...current, ready: true })
        } else if (result.qr_payload && result.qr_payload !== whatsapp.payload) {
          const image = await QRCode.toDataURL(result.qr_payload, { width: 260, margin: 2 })
          if (!cancelled) setWhatsApp(current => current && { ...current, payload: result.qr_payload || '', image })
        } else setWhatsApp(current => current && { ...current })
      }).catch(cause => { if (!cancelled) { setMessage(t('ui.channels.failed.arg', describeError(cause, language))); setWhatsApp(current => current && { ...current }) } })
    }, 3000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [whatsapp, channels, profile, language])

  async function startWhatsApp() {
    await run(async () => {
      const setup = await channels.whatsappStart(scope)
      const payload = setup.qr_payload || ''
      const image = payload ? await QRCode.toDataURL(payload, { width: 260, margin: 2 }) : ''
      setWhatsApp({ id: setup.id, payload, image, ready: setup.status === 'ready' })
    })
  }

  async function cancelWhatsApp() {
    const current = whatsapp
    setWhatsApp(null)
    if (current) await channels.whatsappCancel(scope, current.id).catch(() => {})
  }

  async function applyWhatsApp() {
    if (!whatsapp) return
    await run(async () => {
      await channels.whatsappApply(scope, whatsapp.id)
      setWhatsApp(null)
      setRestartNeeded(true)
      setMessage(t('ui.channels.saved.restart'))
    })
  }

  async function startVendorQr(platform: 'dingtalk' | 'wecom' | 'qqbot') {
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
    await run(async () => {
      const setup = await channels.telegramStart(scope)
      const image = await QRCode.toDataURL(setup.url, { width: 260, margin: 2 })
      setTelegram({ id: setup.id, image, ownerUserId: '', ready: false })
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
      await channels.telegramApply(scope, telegram.id, telegram.ownerUserId)
      setTelegram(null)
      setRestartNeeded(true)
      setMessage(t('ui.channels.saved.restart'))
    })
  }

  function open(row: ChannelStatus) {
    setEditing(row.id)
    setDraft(Object.fromEntries((row.fields || []).filter(field => field.is_list).map(field => [field.key, field.value || ''])))
    setCleared([])
    setMessage('')
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
    if (!Object.keys(env).length && !clear_env.length && selected.enabled) {
      setEditing(null)
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
    <h3 id="other-channels-title">{t('ui.channels.other')}</h3>
    <p>{t('ui.channels.other.manage')}</p>
    <div className="other-channel-grid">
      {rows.map(row => <article className="other-channel-card" key={row.id}>
        <h4>{row.name || row.id}</h4>
        <p>{statusText(row)}</p>
        {!row.supported && <small>{t('ui.channels.unsupported.platform')}</small>}
        {row.error_code && <small>{row.error_code}</small>}
        <div className="other-channel-actions">
          {row.id === 'telegram' && <button disabled={busy || working} onClick={() => void startTelegram()}>{t('ui.channels.scan')}</button>}
          {row.id === 'whatsapp' && <button disabled={busy || working} onClick={() => void startWhatsApp()}>{t(row.configured ? 'ui.channels.whatsapp.use.existing' : 'ui.channels.scan')}</button>}
          {(['dingtalk', 'wecom', 'qqbot'].includes(row.id)) && <button disabled={busy || working} onClick={() => void startVendorQr(row.id as 'dingtalk' | 'wecom' | 'qqbot')}>{t('ui.channels.scan')}</button>}
          <button disabled={busy || working || !row.supported || !row.fields?.length} onClick={() => open(row)}>{t('ui.channels.configure')}</button>
          <button disabled={busy || working || (!row.supported && !row.enabled)} onClick={() => void toggle(row)}>{t(row.enabled ? 'ui.channels.disable' : 'ui.channels.enable')}</button>
          <button disabled={busy || working} onClick={() => void test(row)}>{t('ui.channels.test')}</button>
        </div>
        {row.configured && row.supported && <PairingApproval platform={row.id} profile={profile} disabled={busy || working} />}
      </article>)}
    </div>
    {selected && <div className="channel-qr-backdrop" onMouseDown={event => { if (!working && event.target === event.currentTarget) setEditing(null) }}>
      <form className="channel-qr channel-config" role="dialog" aria-modal="true" aria-labelledby="channel-config-title" onSubmit={event => { event.preventDefault(); void save() }}>
        <h3 id="channel-config-title">{selected.name}</h3>
        {(selected.fields || []).map(field => <label key={field.key} className="channel-config-field">
          <span>{field.prompt || field.key}{field.required ? ' *' : ''}</span>
          <input type={field.is_password ? 'password' : 'text'} autoComplete="off" value={draft[field.key] || ''}
            placeholder={field.is_set && !field.is_list ? t('ui.channels.keep.existing') : ''}
            onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} />
          {field.help && <small>{field.help}</small>}
          {field.is_set && <span><input type="checkbox" checked={cleared.includes(field.key)} onChange={event => setCleared(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{t('ui.channels.clear.field')}</span>}
        </label>)}
        <div><button type="submit" disabled={working}>{t('ui.save')}</button><button type="button" disabled={working} onClick={() => setEditing(null)}>{t('ui.channels.cancel')}</button></div>
      </form>
    </div>}
    {telegram && <div className="channel-qr-backdrop">
      <div className="channel-qr" role="dialog" aria-modal="true" aria-labelledby="telegram-setup-title">
        <h3 id="telegram-setup-title">Telegram</h3>
        <img src={telegram.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />
        <p>{t('ui.channels.pairing.once')}</p>
        <p>{t(telegram.ready ? 'ui.channels.telegram.ready' : 'ui.channels.waiting')}</p>
        {message && <p role="alert">{message}</p>}
        {telegram.ready && <label>{t('ui.channels.telegram.user.id')}<input value={telegram.ownerUserId} onChange={event => setTelegram(current => current && { ...current, ownerUserId: event.target.value })} /></label>}
        {telegram.ready && <button disabled={working || !/^\d+$/.test(telegram.ownerUserId)} onClick={() => void applyTelegram()}>{t('ui.channels.telegram.complete')}</button>}
        <button disabled={working} onClick={() => void cancelTelegram()}>{t('ui.channels.cancel')}</button>
      </div>
    </div>}
    {vendorQr && <div className="channel-qr-backdrop">
      <div className="channel-qr" role="dialog" aria-modal="true" aria-labelledby="vendor-qr-title">
        <h3 id="vendor-qr-title">{vendorQr.platform === 'wecom' ? 'WeCom' : vendorQr.platform === 'qqbot' ? 'QQ Bot' : 'DingTalk'}</h3>
        <img src={vendorQr.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />
        <p>{t('ui.channels.pairing.once')}</p>
        <p>{t(vendorQr.ready ? 'ui.channels.vendor.ready' : 'ui.channels.waiting')}</p>
        {message && <p role="alert">{message}</p>}
        {vendorQr.ready && <button disabled={working} onClick={() => void applyVendorQr()}>{t('ui.channels.telegram.complete')}</button>}
        <button disabled={working} onClick={() => void cancelVendorQr()}>{t('ui.channels.cancel')}</button>
      </div>
    </div>}
    {whatsapp && <div className="channel-qr-backdrop">
      <div className="channel-qr" role="dialog" aria-modal="true" aria-labelledby="whatsapp-qr-title">
        <h3 id="whatsapp-qr-title">WhatsApp</h3>
        {whatsapp.image && <img src={whatsapp.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />}
        <p>{t('ui.channels.pairing.once')}</p>
        <p>{t(whatsapp.ready ? 'ui.channels.vendor.ready' : whatsapp.image ? 'ui.channels.waiting' : 'ui.channels.whatsapp.preparing')}</p>
        {message && <p role="alert">{message}</p>}
        {whatsapp.ready && <button disabled={working} onClick={() => void applyWhatsApp()}>{t('ui.channels.telegram.complete')}</button>}
        <button disabled={working} onClick={() => void cancelWhatsApp()}>{t('ui.channels.cancel')}</button>
      </div>
    </div>}
    {message && <p role="status">{message}</p>}
    {restartNeeded && <button disabled={busy || working} onClick={() => void run(async () => { if (await onRestart()) { setRestartNeeded(false); setMessage(t('ui.channels.connected')) } })}>{t('ui.channels.restart.retry')}</button>}
  </section>
}
