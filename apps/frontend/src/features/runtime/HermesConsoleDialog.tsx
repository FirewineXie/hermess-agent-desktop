import React from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { HermesConsoleSocket } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { parseConsoleFrame, type ConsoleFrame } from './consoleModel'
import './hermes-console.css'

type ConnectionState = 'connecting' | 'ready' | 'running' | 'closed' | 'error'

const normalize = (text: string) => text.replace(/\r?\n/g, '\r\n')
const printable = (value: string) => value >= ' ' || value === '\t'

export default function HermesConsoleDialog({ open, profile, language, onClose }: {
  open: boolean
  profile: string
  language: 'zh-CN' | 'en-US'
  onClose: () => void
}) {
  const { hermesConsole } = useDesktop()
  const zh = language === 'zh-CN'
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const terminalRef = React.useRef<Terminal | null>(null)
  const socketRef = React.useRef<HermesConsoleSocket | null>(null)
  const lineRef = React.useRef('')
  const promptRef = React.useRef('hermes> ')
  const inputPromptRef = React.useRef('hermes> ')
  const historyRef = React.useRef<string[]>([])
  const historyIndexRef = React.useRef<number | null>(null)
  const activeRef = React.useRef(false)
  const pendingRef = React.useRef<string | null>(null)
  const [state, setState] = React.useState<ConnectionState>('connecting')
  const [consoleProfile, setConsoleProfile] = React.useState(profile)
  const [reconnect, setReconnect] = React.useState(0)

  const writeLine = React.useCallback((text = '') => {
    terminalRef.current?.write(`${normalize(text)}\r\n`)
  }, [])
  const showPrompt = React.useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    lineRef.current = ''
    historyIndexRef.current = null
    inputPromptRef.current = promptRef.current
    terminal.write(inputPromptRef.current)
  }, [])
  const send = React.useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current
    if (!socket) return false
    void socket.send(frame).catch(() => {
      setState('error')
      writeLine(zh ? '\x1b[31m控制台发送失败。\x1b[0m' : '\x1b[31mConsole send failed.\x1b[0m')
    })
    return true
  }, [writeLine, zh])
  const cancel = React.useCallback(() => {
    pendingRef.current = null
    activeRef.current = false
    send({ type: 'cancel' })
  }, [send])
  const submit = React.useCallback((raw: string) => {
    const terminal = terminalRef.current
    if (!terminal) return
    const line = raw.trim()
    terminal.write('\r\n')
    lineRef.current = ''
    historyIndexRef.current = null
    const pending = pendingRef.current
    if (pending) {
      if (['y', 'yes'].includes(line.toLowerCase())) {
        pendingRef.current = null
        activeRef.current = true
        setState('running')
        send({ type: 'confirm', command: pending })
      } else cancel()
      return
    }
    if (!line) { showPrompt(); return }
    historyRef.current = [...historyRef.current, line].slice(-200)
    activeRef.current = true
    setState('running')
    if (!send({ type: 'input', line })) {
      activeRef.current = false
      writeLine(zh ? '\x1b[31m控制台未连接。\x1b[0m' : '\x1b[31mConsole is not connected.\x1b[0m')
      showPrompt()
    }
  }, [cancel, send, showPrompt, writeLine, zh])
  const recall = React.useCallback((direction: -1 | 1) => {
    const history = historyRef.current
    if (!history.length) return
    const current = historyIndexRef.current
    if (current === null) {
      if (direction > 0) return
      historyIndexRef.current = history.length - 1
    } else {
      const next = current + direction
      if (next < 0) historyIndexRef.current = 0
      else if (next >= history.length) historyIndexRef.current = null
      else historyIndexRef.current = next
    }
    const value = historyIndexRef.current === null ? '' : history[historyIndexRef.current] || ''
    lineRef.current = value
    terminalRef.current?.write(`\r\x1b[2K${inputPromptRef.current}${value}`)
  }, [])
  const onInput = React.useCallback((data: string) => {
    const terminal = terminalRef.current
    if (!terminal) return
    if (data === '\x1b[A') { recall(-1); return }
    if (data === '\x1b[B') { recall(1); return }
    for (const char of data) {
      if (char === '\u0003') {
        terminal.write('^C\r\n')
        if (activeRef.current || pendingRef.current) cancel(); else showPrompt()
      } else if (char === '\u000c') {
        terminal.clear(); showPrompt()
      } else if (activeRef.current) terminal.write('\x07')
      else if (char === '\r' || char === '\n') submit(lineRef.current)
      else if (char === '\u007f' || char === '\b') {
        if (lineRef.current) {
          lineRef.current = lineRef.current.slice(0, -1)
          terminal.write('\b \b')
        }
      } else if (char !== '\x1b' && printable(char)) {
        lineRef.current += char
        terminal.write(char)
      }
    }
  }, [cancel, recall, showPrompt, submit])
  const onFrame = React.useCallback((frame: ConsoleFrame) => {
    const terminal = terminalRef.current
    if (!terminal) return
    if (frame.type === 'ready') {
      promptRef.current = frame.prompt || 'hermes> '
      setConsoleProfile(frame.profile || profile)
      activeRef.current = false
      setState('ready')
      terminal.clear(); showPrompt(); return
    }
    if (frame.type === 'output') {
      if (frame.data) terminal.write(normalize(frame.data) + (normalize(frame.data).endsWith('\r\n') ? '' : '\r\n'))
      return
    }
    if (frame.type === 'error') { writeLine(`\x1b[31m${frame.message || (zh ? '命令失败。' : 'Command failed.')}\x1b[0m`); return }
    if (frame.type === 'confirm_required') {
      pendingRef.current = frame.command || ''
      activeRef.current = false
      setState('ready')
      if (frame.message) writeLine(`\x1b[33m${frame.message}\x1b[0m`)
      inputPromptRef.current = zh ? '确认？[y/N] ' : 'Confirm? [y/N] '
      lineRef.current = ''
      terminal.write(inputPromptRef.current)
      return
    }
    if (frame.type === 'complete') {
      activeRef.current = false
      if (frame.prompt) promptRef.current = frame.prompt
      if (frame.status === 'confirm_required') return
      if (frame.status === 'exit') { setState('closed'); socketRef.current?.close(); return }
      if (frame.status === 'timeout') writeLine(zh ? '\x1b[31m命令超时。\x1b[0m' : '\x1b[31mCommand timed out.\x1b[0m')
      if (frame.status === 'cancelled') writeLine(zh ? '\x1b[33m已取消。\x1b[0m' : '\x1b[33mCancelled.\x1b[0m')
      pendingRef.current = null
      setState('ready'); showPrompt(); return
    }
    if (frame.type === 'clear') { terminal.clear(); showPrompt() }
  }, [profile, showPrompt, writeLine, zh])

  React.useEffect(() => {
    if (!open || !hostRef.current) return
    let disposed = false
    const terminal = new Terminal({ cursorBlink: true, fontFamily: 'ui-monospace, Cascadia Code, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 1.25, scrollback: 3000,
      theme: { background: '#0b111a', foreground: '#e5edf7', cursor: '#e5edf7', selectionBackground: '#315078' } })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(hostRef.current)
    terminalRef.current = terminal
    const resize = new ResizeObserver(() => { try { fit.fit() } catch { /* closing */ } })
    resize.observe(hostRef.current)
    requestAnimationFrame(() => { try { fit.fit(); terminal.focus() } catch { /* closing */ } })
    const input = terminal.onData(onInput)
    setState('connecting'); setConsoleProfile(profile)
    writeLine(zh ? '\x1b[2m正在连接 Hermes Console…\x1b[0m' : '\x1b[2mConnecting to Hermes Console…\x1b[0m')
    void hermesConsole.socket({ kind: 'profile', profile }, event => {
      if (disposed) return
      if (event.kind === 'message' && event.data) {
        const frame = parseConsoleFrame(event.data)
        if (frame) onFrame(frame)
        else writeLine(zh ? '\x1b[31m收到无效控制台帧。\x1b[0m' : '\x1b[31mMalformed console frame.\x1b[0m')
      } else if (event.kind === 'closed') {
        socketRef.current = null; activeRef.current = false; pendingRef.current = null
        setState(event.reason === 'ended' ? 'closed' : 'error')
        writeLine(zh ? '\x1b[31m控制台连接已关闭，可点击“重新连接”。\x1b[0m' : '\x1b[31mConsole disconnected. Click Reconnect.\x1b[0m')
      }
    }).then(socket => {
      if (disposed) socket.close(); else socketRef.current = socket
    }).catch(cause => {
      if (disposed) return
      setState('error')
      writeLine(`${zh ? '连接失败：' : 'Connection failed: '}${describeError(cause, language)}`)
    })
    return () => {
      disposed = true; socketRef.current?.close(); socketRef.current = null
      input.dispose(); resize.disconnect(); terminal.dispose(); terminalRef.current = null
      lineRef.current = ''; pendingRef.current = null; activeRef.current = false
    }
  }, [hermesConsole, language, onFrame, onInput, open, profile, reconnect, writeLine, zh])

  React.useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open, onClose])

  if (!open) return null
  return <div className="hermes-console-backdrop" role="dialog" aria-modal="true" aria-labelledby="hermes-console-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="hermes-console-dialog">
      <header><div><h2 id="hermes-console-title">Hermes Console</h2><p><span data-state={state}>{state}</span><code>{consoleProfile}</code></p></div>
        <div className="hermes-console-actions">{(state === 'closed' || state === 'error') && <button type="button" onClick={() => setReconnect(value => value + 1)}>{zh ? '重新连接' : 'Reconnect'}</button>}<button type="button" aria-label={zh ? '关闭控制台' : 'Close console'} onClick={onClose}>×</button></div></header>
      <div className="hermes-console-terminal" ref={hostRef} />
      <footer>{zh ? '这是锁定 Hermes 的受限管理控制台，不是系统 Shell。Ctrl+C 取消，Ctrl+L 清屏。' : 'This is the locked Hermes management console, not a system shell. Ctrl+C cancels; Ctrl+L clears.'}</footer>
    </section>
  </div>
}
