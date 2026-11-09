import React from 'react'
import type { ActiveGateway, RemoteGatewayConfig } from '@hermess/contracts'
import { useLanguage } from '../i18n'
import { useDesktop } from './DesktopContext'
import { useGatewayNotices } from '../features/notifications/GatewayNoticesProvider'
import './GatewaySwitcher.css'

type Props = {
  gateway: ActiveGateway
  connected: boolean
  onSwitch: (id: string | null) => void
  onConfigure: () => void
}

export default function GatewaySwitcher({ gateway, connected, onSwitch, onConfigure }: Props) {
  const { runtime } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [open, setOpen] = React.useState(false)
  const [saved, setSaved] = React.useState<RemoteGatewayConfig[] | 'failed' | null>(null)
  const [viewing, setViewing] = React.useState<{ id: string | null; label: string } | null>(null)
  const { items, dispatch } = useGatewayNotices()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const activeId = gateway.mode === 'remote' ? gateway.config.id : null
  const activeLabel = gateway.mode === 'remote' ? gateway.config.label : zh ? '本地' : 'Local'
  React.useEffect(() => {
    if (!open) return
    let live = true
    void runtime.savedRemote().then(configs => {
      if (!live) return
      setSaved(configs)
      dispatch({ type: 'retain', gatewayIds: configs.map(config => config.id) })
    }).catch(() => {
      if (!live) return
      console.warn('[gateway-switch] saved connections unavailable')
      setSaved('failed')
    })
    return () => { live = false }
  }, [open, runtime, dispatch])

  const visibleNotices = viewing ? items.filter(item => item.gatewayId === viewing.id) : []
  const hasVisibleUnread = visibleNotices.some(item => item.unread)
  React.useEffect(() => {
    if (!open || !viewing || !hasVisibleUnread) return
    dispatch({ type: 'read', gatewayId: viewing.id })
    console.info('[gateway-notice] viewed', { gatewayId: viewing.id })
  }, [open, viewing, hasVisibleUnread, dispatch])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (id: string | null) => {
    setOpen(false)
    triggerRef.current?.focus()
    onSwitch(id)
  }
  const unreadLabel = zh ? '有未读通知' : 'Unread notifications'
  const unread = items.some(item => item.unread)
  const row = (id: string | null, label: string) => {
    const notices = items.filter(item => item.gatewayId === id)
    const hasUnread = notices.some(item => item.unread)
    const isViewing = viewing !== null && viewing.id === id
    return <div className="gateway-switcher-row" role="none" key={id ?? 'local'}>
      <button type="button" role="menuitemradio" aria-checked={activeId === id} onClick={() => choose(id)}>
        <span>{label}</span>{activeId === id && <span aria-hidden="true">✓</span>}
      </button>
      {notices.length > 0 && <button type="button" className="gateway-notice-toggle" role="menuitem" aria-expanded={isViewing}
        aria-label={zh ? `${label} 通知${hasUnread ? '（未读）' : ''}` : `${label} notifications${hasUnread ? ' (unread)' : ''}`}
        onClick={() => setViewing(isViewing ? null : { id, label })}>
        {hasUnread ? <span className="gateway-notice-dot" aria-hidden="true" /> : <span aria-hidden="true">≡</span>}
      </button>}
    </div>
  }
  return <div className="gateway-switcher" ref={containerRef}>
    <button ref={triggerRef} type="button" className="gateway-switcher-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => {
      if (!open) { setSaved(null); setViewing(null) }
      setOpen(!open)
    }}>
      <span className={`window-title-status-dot ${connected ? 'ready' : ''}`} aria-hidden="true" />
      <span className="gateway-switcher-label" title={activeLabel}>{activeLabel}</span>
      {unread && <span className="gateway-notice-dot" role="img" aria-label={unreadLabel} title={unreadLabel} />}
      <span aria-hidden="true">▾</span>
    </button>
    {open && <div className="gateway-switcher-menu">
      <div role="menu">
        {row(null, zh ? '本地 Gateway' : 'Local gateway')}
        {Array.isArray(saved) && saved.map(config => row(config.id, config.label))}
        {saved === null && <small role="status">{zh ? '正在读取远程 Gateway…' : 'Loading remote gateways…'}</small>}
        {saved === 'failed' && <small role="status">{zh ? '读取失败，重新打开菜单可重试。' : 'Could not load gateways. Reopen the menu to retry.'}</small>}
        {Array.isArray(saved) && !saved.length && gateway.mode === 'local' && <button type="button" role="menuitem" onClick={() => { setOpen(false); onConfigure() }}>
          {zh ? '配置远程 Gateway…' : 'Configure remote gateway…'}
        </button>}
      </div>
      {viewing && <section className="gateway-notice-list" aria-label={zh ? `${viewing.label} 通知` : `${viewing.label} notifications`}>
        <strong>{viewing.label}</strong>
        {visibleNotices.length ? <ul>{visibleNotices.map(item => <li key={item.id}>{item.text}</li>)}</ul>
          : <p>{zh ? '暂无通知' : 'No notifications'}</p>}
      </section>}
    </div>}
  </div>
}
