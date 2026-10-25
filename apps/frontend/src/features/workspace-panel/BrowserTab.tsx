import React from 'react'
import type { DesktopApi } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'

type BrowserFrame = Awaited<ReturnType<DesktopApi['workspacePanel']['browserFrame']>>

function normalizeUrl(value: string): string | null {
  const candidate = value.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch { return null }
}

export default function BrowserTab({ active, onClose, sessionId, autoFollowToken }: {
  active: boolean; onClose: () => void; sessionId: string; autoFollowToken: number
}) {
  const api = useDesktop().workspacePanel
  const [frame, setFrame] = React.useState<BrowserFrame | null>(null)
  const [input, setInput] = React.useState('')
  const [pageText, setPageText] = React.useState('')
  const [manualTargetId, setManualTargetId] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const imageRef = React.useRef<HTMLImageElement>(null)
  const dragRef = React.useRef<{ pointerId: number; button: 'left' | 'right'; targetId: string } | null>(null)
  const pointerQueue = React.useRef<Promise<void>>(Promise.resolve())
  const latestMove = React.useRef<{ targetId: string; point: { x: number; y: number }; button: 'left' | 'right' | 'none'; buttons: number } | null>(null)
  const moveQueued = React.useRef(false)
  const releasePending = React.useRef(false)
  const currentTarget = frame?.target.id || ''

  React.useEffect(() => { setManualTargetId('') }, [autoFollowToken, sessionId])

  React.useEffect(() => {
    if (!active || !sessionId) return
    let cancelled = false
    async function refresh() {
      try {
        const next = await api.browserFrame(sessionId, manualTargetId || undefined)
        if (!cancelled) {
          setFrame(next)
          setInput(current => document.activeElement?.getAttribute('aria-label') === '网页地址' ? current : next.target.url)
          setError('')
        }
      } catch {
        if (!cancelled) setError('无法连接 Agent 正在使用的浏览器。请在「运行时 → 开发者诊断 → 浏览器日志」查看详情。')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 900)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [active, api, sessionId, manualTargetId])

  async function command(method: string, params: Record<string, unknown> = {}) {
    if (!currentTarget || !sessionId) return
    try { await api.browserCommand(sessionId, currentTarget, method, params); setError('') }
    catch { setError('网页操作失败。') }
  }

  async function navigate(raw: string) {
    const url = normalizeUrl(raw)
    if (!url) { setError('请输入有效的 HTTP 或 HTTPS 地址'); return }
    setBusy(true)
    try { await command('Page.navigate', { url }) }
    finally { setBusy(false) }
  }

  function pointerPosition(event: { clientX: number; clientY: number }) {
    const image = imageRef.current
    if (!image) return null
    const box = image.getBoundingClientRect()
    return { x: (event.clientX - box.left) * image.naturalWidth / box.width,
      y: (event.clientY - box.top) * image.naturalHeight / box.height }
  }

  function sendPointer(targetId: string, type: 'mousePressed' | 'mouseReleased',
    point: { x: number; y: number }, button: 'left' | 'right', buttons: number) {
    pointerQueue.current = pointerQueue.current.catch(() => {}).then(async () => {
      await api.browserCommand(sessionId, targetId, 'Input.dispatchMouseEvent', {
        type, button, buttons, clickCount: 1, ...point,
      })
    }).catch(() => { setError('网页操作失败。') })
    return pointerQueue.current
  }

  function sendMove(targetId: string, point: { x: number; y: number },
    button: 'left' | 'right' | 'none', buttons: number) {
    latestMove.current = { targetId, point, button, buttons }
    if (moveQueued.current) return
    moveQueued.current = true
    pointerQueue.current = pointerQueue.current.catch(() => {}).then(async () => {
      while (latestMove.current) {
        const move = latestMove.current
        latestMove.current = null
        await api.browserCommand(sessionId, move.targetId, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: move.button, buttons: move.buttons, ...move.point,
        })
      }
    }).catch(() => { setError('网页操作失败。') }).finally(() => { moveQueued.current = false })
  }

  function pointerDown(event: React.PointerEvent<HTMLImageElement>) {
    const point = pointerPosition(event)
    if (!point || !currentTarget || dragRef.current || releasePending.current) return
    event.preventDefault()
    imageRef.current?.focus()
    const button = event.button === 2 ? 'right' : 'left'
    dragRef.current = { pointerId: event.pointerId, button, targetId: currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId)
    sendPointer(currentTarget, 'mousePressed', point, button, button === 'left' ? 1 : 2)
  }

  function pointerMove(event: React.PointerEvent<HTMLImageElement>) {
    const drag = dragRef.current
    const point = pointerPosition(event)
    if (!point || !currentTarget || releasePending.current || (drag && drag.pointerId !== event.pointerId)) return
    const button = drag?.button || 'none'
    const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 0
    sendMove(drag?.targetId || currentTarget, point, button, buttons)
  }

  function pointerUp(event: React.PointerEvent<HTMLImageElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    const point = pointerPosition(event)
    if (point) {
      releasePending.current = true
      sendMove(drag.targetId, point, drag.button, drag.button === 'left' ? 1 : 2)
      void sendPointer(drag.targetId, 'mouseReleased', point, drag.button, 0)
        .finally(() => { releasePending.current = false })
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  async function key(event: React.KeyboardEvent<HTMLImageElement>) {
    if (!currentTarget || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    if (event.key.length === 1) {
      await command('Input.insertText', { text: event.key })
    } else {
      const code = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46,
        ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[event.key]
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: event.key, windowsVirtualKeyCode: code || 0 })
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: event.key, windowsVirtualKeyCode: code || 0 })
    }
  }

  async function insertPageText() {
    if (!pageText) return
    await command('Input.insertText', { text: pageText })
    setPageText('')
  }

  return <div className="panel-browser">
    <form className="panel-browser-toolbar" onSubmit={event => { event.preventDefault(); void navigate(input) }}>
      <button type="button" aria-label="后退" disabled={!currentTarget || busy} onClick={() => void command('Browser.back')}>←</button>
      <button type="button" aria-label="前进" disabled={!currentTarget || busy} onClick={() => void command('Browser.forward')}>→</button>
      <input aria-label="网页地址" value={input} onChange={event => setInput(event.target.value)} placeholder="输入网址，例如 example.com" />
      <button type="submit" disabled={!currentTarget || busy}>打开</button>
      <button type="button" disabled={!currentTarget || busy} onClick={() => void command('Page.reload')}>刷新</button>
      <button type="button" onClick={onClose}>关闭</button>
    </form>
    <form className="panel-browser-page-input" onSubmit={event => { event.preventDefault(); void insertPageText() }}>
      <input aria-label="向网页输入文字" value={pageText} autoComplete="off" onChange={event => setPageText(event.target.value)}
        placeholder="先点击网页输入框，再在这里输入" />
      <button type="submit" disabled={!currentTarget || !pageText}>输入</button>
    </form>
    {frame && frame.targets.length > 1 && <select aria-label="浏览器标签" value={manualTargetId || frame.target.id}
      onChange={event => setManualTargetId(event.target.value)}>
      {frame.targets.map(target => <option key={target.id} value={target.id}>{target.title || target.url || '空白页'}</option>)}
    </select>}
    {error && <p className="panel-error">{error}</p>}
    <div className="panel-browser-viewport">
      {frame ? <img ref={imageRef} src={`data:image/jpeg;base64,${frame.image}`} alt={frame.target.title || '浏览器页面'}
        tabIndex={0} draggable={false} onContextMenu={event => event.preventDefault()}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
        onKeyDown={event => void key(event)}
        onWheel={event => { event.preventDefault(); const point = pointerPosition(event); if (point) void command('Input.dispatchMouseEvent', {
          type: 'mouseWheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY,
        }) }} /> : <span>{sessionId ? '正在连接 Agent 浏览器…' : '先创建会话后使用浏览器'}</span>}
    </div>
  </div>
}
