import React from 'react'
import { createPortal } from 'react-dom'

export type ProgrammingOption = { value: string; label: string; group?: string; description?: string; disabled?: boolean; icon?: React.ReactNode; danger?: boolean }

export default function ProgrammingPicker({ label, value, text, options, disabled, icon, warning, message, footer, onChange, variant }: {
  label: string; value: string; text: string; options: ProgrammingOption[]; disabled?: boolean
  icon?: React.ReactNode; warning?: boolean; message?: string; footer?: React.ReactNode; onChange: (value: string) => void
  variant?: 'permissions'
}) {
  const [open, setOpen] = React.useState(false)
  const [position, setPosition] = React.useState<React.CSSProperties>({})
  const trigger = React.useRef<HTMLButtonElement>(null)
  const menu = React.useRef<HTMLDivElement>(null)
  const id = React.useId()
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus() }
  const toggle = () => {
    if (open) { close(); return }
    const rect = trigger.current!.getBoundingClientRect()
    const width = Math.min(variant === 'permissions' ? 390 : 300, window.innerWidth - 24)
    setPosition({ width, left: Math.max(12, Math.min(variant === 'permissions' ? rect.left : rect.right - width, window.innerWidth - width - 12)),
      ...(rect.top > 180 ? { bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(360, rect.top - 20) }
        : { top: rect.bottom + 8, maxHeight: Math.max(100, window.innerHeight - rect.bottom - 24) }) })
    setOpen(true)
  }
  React.useEffect(() => {
    if (!open) return
    if (disabled) { setOpen(false); return }
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')
    ;(selected || menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') || menu.current)?.focus()
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close()
    }
    const dismiss = () => close()
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss) }
  }, [open, disabled])
  return <>
    <button ref={trigger} type="button" className={`programming-picker-trigger${warning ? ' is-warning' : ''}${variant ? ' is-permissions' : ''}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} title={text} onClick={toggle} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) toggle() }
    }}>
      {icon}<span>{text}</span><svg className="programming-picker-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className={`programming-picker-menu${variant ? ' is-permissions' : ''}`} style={position} tabIndex={-1} onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close()
    }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (!items.length) return
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }}>
      <div className="programming-picker-heading">{variant === 'permissions' ? (label === '编程权限' ? '应如何批准操作？' : 'How should actions be approved?') : label}</div>
      {message && <p className="programming-picker-message" role={warning ? 'alert' : 'status'}>{message}</p>}
      {options.map((option, index) => <React.Fragment key={option.value}>
        {option.group && option.group !== options[index - 1]?.group && <div className="programming-picker-group">{option.group}</div>}
        <button type="button" role="menuitemradio" className={option.danger ? 'is-danger' : undefined} aria-checked={value === option.value} disabled={option.disabled} onClick={() => { onChange(option.value); close(true) }}>
          {option.icon}<span className="programming-picker-option-copy"><span className="programming-picker-option-label">{option.label}</span>{option.description && <small>{option.description}</small>}</span>
          {value === option.value && <svg className="programming-picker-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}
        </button>
      </React.Fragment>)}
      {footer && <div className="programming-picker-footer" onClick={() => close(true)}>{footer}</div>}
    </div>, document.body)}
  </>
}
