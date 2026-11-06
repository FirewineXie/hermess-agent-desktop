import React from 'react'
import { useLanguage } from '../i18n'

type Props = { mode: 'local' | 'remote'; label?: string; connected: boolean; onLocal: () => void; onRemote: () => void }

export default function GatewaySwitcher({ mode, label, connected, onLocal, onRemote }: Props) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [open, setOpen] = React.useState(false)
  return <div className="gateway-switcher">
    <button type="button" className="gateway-switcher-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className={`window-title-status-dot ${connected ? 'ready' : ''}`} aria-hidden="true" />
      {mode === 'local' ? (zh ? '本地' : 'Local') : label || (zh ? '远程' : 'Remote')} <span aria-hidden="true">▾</span>
    </button>
    {open && <div className="gateway-switcher-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onLocal() }}>{zh ? '本地 Gateway' : 'Local gateway'} {mode === 'local' ? '✓' : ''}</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onRemote() }}>{zh ? '远程 Gateway' : 'Remote gateway'} {mode === 'remote' ? '✓' : ''}</button>
    </div>}
  </div>
}
