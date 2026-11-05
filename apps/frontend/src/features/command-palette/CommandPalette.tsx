import React from 'react'
import type { PaletteItem } from './model'
import { searchPalette } from './model'
import './command-palette.css'

export function useCommandPalette() {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(current => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return { open, show: () => setOpen(true), close: () => setOpen(false) }
}

type Props = {
  open: boolean
  language: string
  items: PaletteItem[]
  onClose: () => void
  onExecute: (item: PaletteItem) => boolean | Promise<boolean>
}

export default function CommandPalette({ open, language, items, onClose, onExecute }: Props) {
  const zh = language === 'zh-CN'
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const restoreFocus = React.useRef<HTMLElement | null>(null)
  const results = React.useMemo(() => searchPalette(items, query), [items, query])

  React.useEffect(() => {
    if (!open) return
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setSelected(0)
    setError('')
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => restoreFocus.current?.focus()
  }, [open])
  React.useEffect(() => setSelected(0), [query])

  const execute = async (item: PaletteItem) => {
    if (busy) return
    setBusy(true)
    setError('')
    const operation = crypto.randomUUID()
    console.info('[command-palette] execute started', { operation, target: item.id })
    try {
      const accepted = await onExecute(item)
      console.info('[command-palette] execute completed', { operation, target: item.id, accepted })
      if (accepted) onClose()
    } catch (cause) {
      console.error('[command-palette] execute failed', { operation, target: item.id, errorType: cause instanceof Error ? cause.name : 'unknown' })
      setError(zh ? '操作失败，请重试。' : 'Action failed. Please try again.')
    } finally { setBusy(false) }
  }

  if (!open) return null
  return <div className="command-palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label={zh ? '全局命令面板' : 'Command palette'} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() }
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(current => Math.min(current + 1, Math.max(results.length - 1, 0))) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(current => Math.max(current - 1, 0)) }
      if (event.key === 'Enter' && results[selected]) { event.preventDefault(); void execute(results[selected]) }
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }}>
      <div className="command-palette-search"><span aria-hidden="true">⌕</span><input ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-palette-results" aria-activedescendant={results[selected] ? `command-palette-option-${selected}` : undefined} value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '搜索会话、页面、设置或操作…' : 'Search sessions, pages, settings or actions…'} /><kbd>Esc</kbd></div>
      <div id="command-palette-results" className="command-palette-results" role="listbox" aria-label={zh ? '搜索结果' : 'Search results'}>
        {results.length ? results.map((item, index) => <button id={`command-palette-option-${index}`} key={item.id} type="button" role="option" aria-selected={index === selected} className={index === selected ? 'selected' : ''} disabled={busy} onMouseEnter={() => setSelected(index)} onClick={() => void execute(item)}><span className="command-palette-kind">{{ action: zh ? '操作' : 'Action', page: zh ? '页面' : 'Page', setting: zh ? '设置' : 'Setting', session: zh ? '会话' : 'Session' }[item.kind]}</span><span className="command-palette-label"><strong>{item.title}</strong><small>{item.detail}</small></span><span aria-hidden="true">↵</span></button>) : <p>{zh ? '没有匹配结果' : 'No matching results'}</p>}
      </div>
      {error && <p className="command-palette-error" role="alert">{error}</p>}
      <footer>{zh ? '↑↓ 选择 · Enter 打开 · Esc 关闭' : '↑↓ Select · Enter Open · Esc Close'}</footer>
    </div>
  </div>
}
