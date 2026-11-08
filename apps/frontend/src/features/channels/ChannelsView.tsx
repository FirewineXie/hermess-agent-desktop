import React from 'react'
import QRCode from 'qrcode'
import type { ChannelAccess, ChannelQrStart, ChannelStatus } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'
import OtherChannels from './OtherChannels'
import PairingApproval from './PairingApproval'
import { channelStatusTone, hasPendingChannelRestart } from './channelSetupModel'
import { keepFocusInside } from '../extensions/dialogFocus'
import './channels.css'

type Platform = 'feishu' | 'weixin'
type RowsState = 'loading' | 'ready' | 'error'

const STATE_LABELS: Record<string, string> = {
  connected: 'ui.channels.state.connected',
  fatal: 'ui.channels.state.failed',
  pending_restart: 'ui.channels.state.pending.restart',
  disabled: 'ui.channels.state.disabled',
  not_configured: 'ui.channels.state.not.configured',
  gateway_stopped: 'ui.channels.state.gateway.stopped',
  startup_failed: 'ui.channels.state.failed',
  starting: 'ui.channels.state.starting',
  degraded: 'ui.channels.state.degraded',
}

function channelStatusText(row: ChannelStatus | undefined, connected: boolean, rowsState: RowsState, t: (key: string) => string): string {
  if (!connected) return '—'
  if (rowsState === 'loading') return t('ui.loading')
  if (rowsState === 'error') return t('ui.channels.status.failed')
  const configured = t(row?.configured ? 'ui.channels.configured' : 'ui.channels.unconfigured')
  const state = row?.state ? (STATE_LABELS[row.state] ? t(STATE_LABELS[row.state]) : row.state) : ''
  return state ? `${configured} · ${state}` : configured
}

export default function ChannelsView({ connected, profile, epoch, onRestart, onForceRestart }: { connected: boolean; profile: string | null; epoch: string | null; onRestart: () => Promise<boolean>; onForceRestart: () => Promise<boolean> }) {
  const { channels } = useDesktop()
  const language = useLanguage()
  const t = (key: string, ...args: unknown[]) => translateApp(language, key, ...args)
  const workspace = workspaceKey(epoch, profile)
  const [rows, setRows] = useProfileState<ChannelStatus[]>(workspace, [], 'channels:rows')
  const [rowsState, setRowsState] = useProfileState<RowsState>(workspace, 'loading', 'channels:rows-state')
  const [active, setActive] = useProfileState<{ profile: string; platform: Platform; qr: ChannelQrStart; image: string; access: ChannelAccess } | null>(workspace, null, 'channels:active-qr')
  const [status, setStatus] = useProfileState(workspace, '', 'channels:status')
  const [busy, setBusy] = useProfileState(workspace, false, 'channels:busy')
  const [pendingRestart, setPendingRestart] = useProfileState(workspace, false, 'channels:pending-restart')
  const [tick, setTick] = useProfileState(workspace, 0, 'channels:poll-tick')
  const [polling, setPolling] = useProfileState(workspace, false, 'channels:polling')
  const [accessConfirmed, setAccessConfirmed] = useProfileState(workspace, false, 'channels:access-confirmed')
  const [pollError, setPollError] = useProfileState(workspace, false, 'channels:poll-error')
  const [authorized, setAuthorized] = useProfileState(workspace, false, 'channels:authorized')
  const restartRef = React.useRef(onRestart)
  React.useEffect(() => { restartRef.current = onRestart }, [onRestart])
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const dialogOpenerRef = React.useRef<HTMLElement | null>(null)
  const dialogWasOpen = React.useRef(false)
  const scope = (owner: string) => ({ kind: 'profile' as const, profile: owner })

  const refresh = React.useCallback(async () => {
    if (!connected || !profile) return
    setRowsState(current => current === 'ready' ? current : 'loading')
    try {
      const result = await channels.status(scope(profile))
      setRows(result.platforms)
      setRowsState('ready')
    } catch (cause) {
      setRowsState('error')
      throw cause
    }
  }, [channels, connected, profile, epoch])

  React.useEffect(() => { void refresh().catch(() => setStatus(t('ui.channels.status.failed'))) }, [refresh])
  React.useEffect(() => {
    if (active) {
      dialogWasOpen.current = true
      dialogRef.current?.focus()
    } else if (dialogWasOpen.current) {
      dialogWasOpen.current = false
      dialogOpenerRef.current?.focus()
      dialogOpenerRef.current = null
    }
  }, [active?.qr.id])
  React.useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !polling) { event.preventDefault(); void cancel() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active?.qr.id, polling])
  React.useEffect(() => {
    if (!active || !accessConfirmed || pollError) return
    let cancelled = false
    let completing = false
    let restartPending = false
    const timer = window.setTimeout(async () => {
      setPolling(true)
      try {
        const result = await channels.poll(scope(active.profile), active.qr.id, active.access, () => {
          if (cancelled) return
          setAuthorized(true)
          setStatus(t('ui.channels.saving'))
        })
        if (cancelled) return
        if (result.status === 'connected') {
          completing = true
          setActive(null)
          if (result.restart_required) {
            setBusy(true)
            setStatus(t('ui.channels.waiting.for.restart'))
            restartPending = true
            const restarted = await restartRef.current()
            if (!restarted) {
              setPendingRestart(true)
              setStatus(t('ui.channels.restart.deferred'))
              await refresh().catch(() => {})
              return
            }
            restartPending = false
          }
          await refresh()
          setStatus(t(active.access === 'open' ? 'ui.channels.connected.open' : 'ui.channels.connected.pairing'))
        } else if (result.status === 'expired') {
          setActive(null)
          setStatus(t('ui.channels.expired'))
        } else {
          setStatus(t(result.status === 'scanned' ? 'ui.channels.scanned' : 'ui.channels.waiting'))
          setTick(v => v + 1)
        }
      } catch (cause) {
        if (!cancelled || completing) {
          if (restartPending) setPendingRestart(true)
          else setPollError(true)
          setStatus(t('ui.channels.failed.arg', describeError(cause, language)))
        }
      } finally { if (!cancelled || completing) { if (completing) setBusy(false); setPolling(false) } }
    }, active.qr.poll_interval * 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [active, accessConfirmed, channels, language, pollError, refresh, tick])

  async function begin(platform: Platform) {
    dialogOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    setPolling(false)
    setAccessConfirmed(false)
    setPollError(false)
    setAuthorized(false)
    setStatus('')
    try {
      if (active) void channels.cancel(scope(active.profile), active.qr.id).catch(() => {})
      if (!profile) throw new Error('No active Profile')
      const qr = await channels.start(scope(profile), platform)
      const image = await QRCode.toDataURL(qr.url, { width: 260, margin: 2 })
      setActive({ profile, platform, qr, image, access: 'open' })
      setStatus(t('ui.channels.access.choose'))
    } catch (cause) { setStatus(t('ui.channels.failed.arg', describeError(cause, language))) }
    finally { setBusy(false) }
  }

  async function cancel() {
    setActive(null)
    setPolling(false)
    setAccessConfirmed(false)
    setPollError(false)
    setAuthorized(false)
    setStatus('')
    if (active) await channels.cancel(scope(active.profile), active.qr.id).catch(() => {})
  }

  async function retryRestart(force: boolean) {
    if (force && !window.confirm(t('ui.channels.restart.force.confirm'))) return
    setBusy(true)
    setStatus(t('ui.channels.waiting.for.restart'))
    try {
      const restarted = await (force ? onForceRestart() : onRestart())
      if (!restarted) {
        setStatus(t('ui.channels.restart.deferred'))
        return
      }
      setPendingRestart(false)
      await refresh()
      setStatus(t('ui.channels.connected'))
    } catch (cause) {
      setStatus(t('ui.channels.failed.arg', describeError(cause, language)))
    } finally { setBusy(false) }
  }

  const otherRows = rows.filter(row => !['feishu', 'weixin', 'api_server', 'webhook', 'msgraph_webhook', 'relay'].includes(row.id))
  const visibleRows = rows.filter(row => !['api_server', 'webhook', 'msgraph_webhook', 'relay'].includes(row.id))
  const configuredCount = visibleRows.filter(row => row.configured).length
  const connectedCount = visibleRows.filter(row => row.state === 'connected').length

  return <section className="channels-view">
    <header className="channels-header">
      <div>
        <span className="channels-eyebrow">{t('ui.channels.eyebrow')}</span>
        <h2>{t('ui.channels')}</h2>
        <p>{t('ui.channels.intro')}</p>
      </div>
      <div className={`channels-runtime-state ${connected ? 'is-online' : 'is-offline'}`}>
        <span aria-hidden="true" />
        {t(connected ? 'ui.channels.runtime.online' : 'ui.channels.runtime.offline')}
      </div>
    </header>
    <div className="channels-overview" aria-label={t('ui.channels.overview')}>
      <div><strong>{visibleRows.length || '—'}</strong><span>{t('ui.channels.overview.available')}</span></div>
      <div><strong>{configuredCount}</strong><span>{t('ui.channels.overview.configured')}</span></div>
      <div><strong>{connectedCount}</strong><span>{t('ui.channels.overview.connected')}</span></div>
      <p>{t('ui.channels.profile.scope', profile || '—')}</p>
    </div>
    {!connected && <div className="channels-notice is-warning" role="status"><span aria-hidden="true">!</span><p>{t('ui.channels.start.runtime')}</p></div>}
    <section className="channels-section" aria-labelledby="channels-quick-title">
      <div className="channels-section-heading">
        <div><h3 id="channels-quick-title">{t('ui.channels.quick')}</h3><p>{t('ui.channels.quick.help')}</p></div>
      </div>
      <div className="channel-list channel-featured-list">
      {(['feishu', 'weixin'] as const).map(platform => {
        const row = rows.find(item => item.id === platform)
        const rowReady = connected && rowsState === 'ready'
        const name = platform === 'feishu' ? t('ui.channels.feishu') : t('ui.channels.weixin')
        return <article className="channel-row channel-featured" key={platform}>
          <div className={`channel-logo channel-logo-${platform}`} aria-hidden="true">{platform === 'feishu' ? '飞' : '微'}</div>
          <div className="channel-row-main">
            <div className="channel-title-line"><h4>{name}</h4><span className={`channel-status-badge is-${channelStatusTone(row?.state)}`}>{channelStatusText(row, connected, rowsState, t)}</span></div>
            <p>{t(platform === 'feishu' ? 'ui.channels.feishu.description' : 'ui.channels.weixin.description')}</p>
            {rowReady && (row?.error_message || row?.error_code) && <p className="channel-error" role="alert">{row.error_message || (row.error_code === 'adapter_unavailable' ? t('ui.channels.adapter.unavailable') : row.error_code)}</p>}
            {rowReady && row?.configured && profile && <PairingApproval key={workspace} platform={platform} profile={profile} disabled={busy} />}
          </div>
          <div className="channel-row-actions"><button className="channel-primary-action" disabled={!rowReady || busy} onClick={() => void begin(platform)}>{rowReady && row?.configured ? t('ui.channels.reconnect') : t('ui.channels.scan')}</button></div>
        </article>
      })}
      </div>
    </section>
    {connected && profile && rowsState === 'ready' && otherRows.length > 0 && <OtherChannels
      key={workspace} rows={otherRows} profile={profile} busy={busy} onRefresh={refresh} onRestart={onRestart}
      statusText={row => channelStatusText(row, connected, rowsState, t)} />}
    {connected && rowsState === 'error' && <div className="channels-notice is-danger"><p>{t('ui.channels.status.failed')}</p><button onClick={() => { setStatus(''); void refresh().catch(() => setStatus(t('ui.channels.status.failed'))) }}>{t('ui.channels.retry.status')}</button></div>}
    {active && <div className="channel-qr-backdrop" onMouseDown={event => { if (!polling && event.target === event.currentTarget) void cancel() }}>
      <div className="channel-qr" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="channel-qr-title" onKeyDown={keepFocusInside}>
        <h3 id="channel-qr-title">{active.platform === 'feishu' ? t('ui.channels.feishu.scan') : t('ui.channels.weixin.scan')}</h3>
        {!authorized && <img src={active.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />}
        <p className="channel-qr-hint">{t(authorized ? 'ui.channels.authorized' : 'ui.channels.pairing.once')}</p>
        {!accessConfirmed ? <fieldset className="channel-access">
          <legend>{t('ui.channels.access.title')}</legend>
          <label data-selected={active.access === 'open'}><input type="radio" name="channel-access" checked={active.access === 'open'} onChange={() => setActive(current => current && { ...current, access: 'open' })} /><span>{t('ui.channels.access.open')}</span></label>
          <label data-selected={active.access === 'pairing'}><input type="radio" name="channel-access" checked={active.access === 'pairing'} onChange={() => setActive(current => current && { ...current, access: 'pairing' })} /><span>{t('ui.channels.access.pairing')}</span></label>
          <small>{t('ui.channels.access.replace')}</small>
        </fieldset> : !authorized && <p className="channel-access-locked">{t(active.access === 'open' ? 'ui.channels.access.selected.open' : 'ui.channels.access.selected.pairing')}</p>}
        <p className="channel-qr-status" role="status">{status}</p>
        <div className="channel-qr-actions">
          {!accessConfirmed && <button className="channel-qr-primary" onClick={() => { setAccessConfirmed(true); setStatus(t('ui.channels.waiting')) }}>{t('ui.channels.access.confirm')}</button>}
          {pollError && <button className="channel-qr-primary" onClick={() => { setPollError(false); setTick(value => value + 1) }}>{t('ui.channels.retry.poll')}</button>}
          <button disabled={polling} onClick={() => void cancel()}>{t('ui.channels.cancel')}</button>
        </div>
      </div>
    </div>}
    {!active && status && <div className="channels-notice" role="status"><p>{status}</p></div>}
    {!active && hasPendingChannelRestart(rows, pendingRestart) && <div className="channel-restart-actions">
      <button disabled={busy || !connected} onClick={() => void retryRestart(false)}>{t('ui.channels.restart.retry')}</button>
      <button disabled={busy || !connected} onClick={() => void retryRestart(true)}>{t('ui.channels.restart.force')}</button>
    </div>}
  </section>
}
