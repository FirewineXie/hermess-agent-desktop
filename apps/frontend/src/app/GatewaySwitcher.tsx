import React from 'react'
import { useLanguage } from '../i18n'

type Props = { mode: 'local' | 'remote'; label?: string; connected: boolean; onLocal: () => void; onRemote: () => void }

export default function GatewaySwitcher({ mode, label, connected, onLocal, onRemote }: Props) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
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
  return <div className="gateway-switcher" ref={containerRef}>
    <button ref={triggerRef} type="button" className="gateway-switcher-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className={`window-title-status-dot ${connected ? 'ready' : ''}`} aria-hidden="true" />
      {mode === 'local' ? (zh ? '本地' : 'Local') : label || (zh ? '远程' : 'Remote')} <span aria-hidden="true">▾</span>
    </button>
    {open && <div className="gateway-switcher-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onLocal() }}>{zh ? '本地 Gateway' : 'Local gateway'} {mode === 'local' ? '✓' : ''}</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onRemote() }}>{zh ? '远程 Gateway' : 'Remote gateway'} {mode === 'remote' ? '✓' : ''}</button>
    </div>}
  </div>
}
