import React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './quick-entry.css'

type Result = { id: string; ok: boolean; message: string }

function QuickEntry() {
  const [text, setText] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [unconfirmedText, setUnconfirmedText] = React.useState('')
  const pendingId = React.useRef('')
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const input = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    let live = true
    let cleanup: (() => void) | undefined
    void listen<Result>('quick-entry-result', event => {
      if (!live || event.payload.id !== pendingId.current) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      pendingId.current = ''
      setPending(false)
      setUnconfirmedText('')
      if (event.payload.ok) {
        setText('')
        setStatus('')
        void getCurrentWindow().hide()
      } else setStatus(event.payload.message || '提交失败，请检查主窗口会话。')
    }).then(unlisten => { if (live) { cleanup = unlisten; setReady(true) } else unlisten() })
      .catch(() => setStatus('无法监听提交结果，请重新打开快捷输入窗。'))
    const focus = () => input.current?.focus()
    window.addEventListener('focus', focus)
    focus()
    return () => {
      live = false
      cleanup?.()
      window.removeEventListener('focus', focus)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  async function submit() {
    const prompt = text.trim()
    if (!prompt || pending || !ready || prompt === unconfirmedText) return
    const id = crypto.randomUUID()
    pendingId.current = id
    setPending(true)
    setStatus('正在交给主窗口…')
    timer.current = setTimeout(() => {
      setPending(false)
      setUnconfirmedText(prompt)
      setStatus('提交结果未确认，消息可能已送达。请先检查主窗口会话，避免重复发送。')
    }, 15_000)
    try {
      await invoke('submit_quick_entry', { id, text: prompt })
    } catch (error) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      pendingId.current = ''
      setPending(false)
      setStatus(String(error))
    }
  }

  return <main className="quick-entry">
    <header data-tauri-drag-region><strong data-tauri-drag-region>Hermess 快捷输入</strong><button type="button" aria-label="关闭快捷输入" onClick={() => void getCurrentWindow().hide()}>×</button></header>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <textarea ref={input} value={text} onChange={event => setText(event.target.value)} placeholder="输入消息，交给当前 Profile 的聊天会话" aria-label="快捷输入消息" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); void getCurrentWindow().hide() }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
      }} />
      <button type="submit" disabled={!text.trim() || pending || !ready || text.trim() === unconfirmedText}>发送</button>
    </form>
    <p role="status">{status || 'Enter 发送 · Shift+Enter 换行 · Esc 隐藏'}</p>
  </main>
}

const root = document.getElementById('root')
if (!root) throw new Error('Quick entry root is missing')
createRoot(root).render(<QuickEntry />)
