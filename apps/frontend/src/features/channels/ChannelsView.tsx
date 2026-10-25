import React from 'react'
import QRCode from 'qrcode'
import type { ChannelQrStart, ChannelStatus } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage, translateApp } from '../../i18n'

type Platform = 'feishu' | 'weixin'

export default function ChannelsView({ connected, onRestart, onForceRestart }: { connected: boolean; onRestart: () => Promise<boolean>; onForceRestart: () => Promise<boolean> }) {
  const { channels } = useDesktop()
  const language = useLanguage()
  const t = (key: string, ...args: unknown[]) => translateApp(language, key, ...args)
  const [rows, setRows] = React.useState<ChannelStatus[]>([])
  const [rowsState, setRowsState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [active, setActive] = React.useState<{ platform: Platform; qr: ChannelQrStart; image: string } | null>(null)
  const [status, setStatus] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [pendingRestart, setPendingRestart] = React.useState(false)
  const [tick, setTick] = React.useState(0)
  const activeRef = React.useRef(active)
  activeRef.current = active

  const refresh = React.useCallback(async () => {
    if (!connected) return
    setRowsState('loading')
    try {
      const result = await channels.status()
      setRows(result.platforms)
      setRowsState('ready')
    } catch (cause) {
      setRowsState('error')
      throw cause
    }
  }, [channels, connected])

  React.useEffect(() => { void refresh().catch(() => setStatus(t('ui.channels.status.failed'))) }, [refresh])
  React.useEffect(() => () => { if (activeRef.current) void channels.cancel(activeRef.current.qr.id) }, [channels])

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
    let completing = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await channels.poll(active.qr.id)
        if (cancelled) return
        if (result.status === 'connected') {
          completing = true
          setActive(null)
          if (result.restart_required) {
            setBusy(true)
            setStatus(t('ui.channels.waiting.for.restart'))
            const restarted = await onRestart()
            if (!restarted) {
              setPendingRestart(true)
              setStatus(t('ui.channels.restart.deferred'))
              await refresh().catch(() => {})
              return
            }
          }
          await refresh()
          setStatus(t('ui.channels.connected'))
        } else if (result.status === 'expired') {
          setActive(null)
          setStatus(t('ui.channels.expired'))
        } else {
          setStatus(t(result.status === 'scanned' ? 'ui.channels.scanned' : 'ui.channels.waiting'))
          setTick(v => v + 1)
        }
      } catch (cause) {
        if (!cancelled || completing) { setActive(null); setStatus(t('ui.channels.failed.arg', describeError(cause, language))) }
      } finally { if (!cancelled || completing) setBusy(false) }
    }, active.qr.poll_interval * 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [active, channels, language, onRestart, refresh, tick])

  async function begin(platform: Platform) {
    setBusy(true)
    setStatus('')
    try {
      if (active) await channels.cancel(active.qr.id)
      const qr = await channels.start(platform)
      const image = await QRCode.toDataURL(qr.url, { width: 260, margin: 2 })
      setActive({ platform, qr, image })
      setStatus(t('ui.channels.waiting'))
    } catch (cause) { setStatus(t('ui.channels.failed.arg', describeError(cause, language))) }
    finally { setBusy(false) }
  }

  async function cancel() {
    if (active) await channels.cancel(active.qr.id)
    setActive(null)
    setStatus('')
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

  return <section className="channels-view">
    <h2>{t('ui.channels')}</h2>
    <p>{t('ui.channels.intro')}</p>
    {!connected && <p>{t('ui.channels.start.runtime')}</p>}
    <div className="channel-cards">
      {(['feishu', 'weixin'] as const).map(platform => {
        const row = rows.find(item => item.id === platform)
        const rowReady = connected && rowsState === 'ready'
        const state = row?.state === 'connected' ? t('ui.channels.state.connected')
          : row?.state === 'fatal' ? t('ui.channels.state.failed')
            : row?.state === 'pending_restart' ? t('ui.channels.state.pending.restart')
              : row?.state || ''
        const displayStatus = !connected ? '—'
          : rowsState === 'loading' ? t('ui.loading')
            : rowsState === 'error' ? t('ui.channels.status.failed')
              : row?.configured ? t('ui.channels.configured') : t('ui.channels.unconfigured')
        return <article className="channel-card" key={platform}>
          <h3>{platform === 'feishu' ? t('ui.channels.feishu') : t('ui.channels.weixin')}</h3>
          <p>{displayStatus}{rowReady && state ? ` · ${state}` : ''}</p>
          {rowReady && row?.error_code && <p role="alert">{row.error_code === 'adapter_unavailable' ? t('ui.channels.adapter.unavailable') : row.error_code}</p>}
          <button disabled={!rowReady || busy} onClick={() => void begin(platform)}>{rowReady && row?.configured ? t('ui.channels.reconnect') : t('ui.channels.scan')}</button>
        </article>
      })}
    </div>
    {connected && rowsState === 'error' && <button onClick={() => { setStatus(''); void refresh().catch(() => setStatus(t('ui.channels.status.failed'))) }}>{t('ui.channels.retry.status')}</button>}
    {active && <div className="channel-qr">
      <h3>{active.platform === 'feishu' ? t('ui.channels.feishu.scan') : t('ui.channels.weixin.scan')}</h3>
      <img src={active.image} width="260" height="260" alt={t('ui.channels.qr.alt')} />
      <p>{status}</p>
      <button onClick={() => void cancel()}>{t('ui.channels.cancel')}</button>
    </div>}
    {!active && status && <p role="status">{status}</p>}
    {!active && (pendingRestart || rows.some(row => row.state === 'pending_restart')) && <div className="channel-restart-actions">
      <button disabled={busy || !connected} onClick={() => void retryRestart(false)}>{t('ui.channels.restart.retry')}</button>
      <button disabled={busy || !connected} onClick={() => void retryRestart(true)}>{t('ui.channels.restart.force')}</button>
    </div>}
  </section>
}
