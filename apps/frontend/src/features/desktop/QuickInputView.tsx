import React from 'react'
import type { QuickTarget, Unsubscribe } from '@hermess/contracts'
import { QuickInputFlight } from './quickFlight'
import './desktop-settings.css'

export type QuickInputApi = {
  target(): Promise<QuickTarget | null>
  submit(requestId: string, target: QuickTarget, text: string): Promise<void>
  onResult(handler: (result: { requestId: string; error: string | null }) => void): Promise<Unsubscribe>
  hide(): Promise<void>
}

export default function QuickInputView({ api }: { api: QuickInputApi }) {
  const [text, setText] = React.useState('')
  const [bound, setBound] = React.useState<QuickTarget | null>(null)
  const [current, setCurrent] = React.useState<QuickTarget | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const pending = React.useRef(new QuickInputFlight())
  const [ready, setReady] = React.useState(false)
  const timeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const input = React.useRef<HTMLTextAreaElement>(null)
  const changed = JSON.stringify(bound) !== JSON.stringify(current)
  React.useEffect(() => {
    let active = true
    const read = () => void api.target().then(value => { if (active) { setCurrent(value); setBound(previous => previous || value) } }).catch(() => { if (active) setCurrent(null) })
    read(); const timer = setInterval(read, 800)
    const listener = api.onResult(result => {
      if (!active || !pending.current.settle(result.requestId)) return
      if (timeout.current) clearTimeout(timeout.current)
      setBusy(false)
      if (result.error) setError(result.error)
      else { setText(''); setError(''); setBound(null) }
    })
    void listener.then(() => { if (active) setReady(true) }).catch(() => { if (active) { setReady(false); setError('无法接收主窗口确认，请重新打开快捷输入窗。') } })
    const focus = () => { read(); input.current?.focus() }
    window.addEventListener('focus', focus)
    return () => { active = false; clearInterval(timer); if (timeout.current) clearTimeout(timeout.current); void listener.then(unsubscribe => unsubscribe()).catch(() => {}); window.removeEventListener('focus', focus) }
  }, [api])
  const send = async () => {
    if (!ready || !bound || changed || bound.busy || busy || !text.trim()) return
    const requestId = crypto.randomUUID()
    if (!pending.current.begin(requestId)) return
    setBusy(true); setError('')
    try {
      await api.submit(requestId, bound, text)
      if (pending.current.waiting(requestId)) timeout.current = setTimeout(() => setError('主窗口尚未确认提交，请打开主窗口检查。为避免重复发送，当前请求保持等待。'), 35000)
    } catch { if (pending.current.settle(requestId)) { setBusy(false); setError('目标已变化、会话忙碌或主窗口未就绪，请刷新目标后重试。') } }
  }
  return <main className="quick-composer" onKeyDown={e => { if (e.key === 'Escape') void api.hide() }}>
    <header><strong>Hermess · 快捷输入</strong><button disabled={busy} onClick={() => { setBound(current); setError('') }}>刷新目标</button><button onClick={() => void api.hide()} aria-label="隐藏">×</button></header>
    <div className="quick-target">{bound ? `${bound.profile} · ${bound.sessionId || '新会话'}` : '等待主窗口连接运行时'}</div>
    <textarea ref={input} autoFocus disabled={busy} value={text} onChange={e => setText(e.target.value)} placeholder="输入消息…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
    <footer><span role="status">{error || (changed ? '发送目标已变化，请刷新目标确认。' : bound?.busy ? '主窗口有草稿、附件或正在处理任务。' : 'Enter 发送 · Shift+Enter 换行')}</span><button disabled={!ready || busy || changed || !bound || bound.busy || !text.trim()} onClick={() => void send()}>{busy ? '提交中…' : '发送'}</button></footer>
  </main>
}
