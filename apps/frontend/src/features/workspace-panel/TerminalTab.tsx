import React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useDesktop } from '../../app/DesktopContext'
import type { WorkspaceScope } from '@hermess/contracts'

export default function TerminalTab({ scope, id, active }: { scope: WorkspaceScope; id: string; active: boolean }) {
  const api = useDesktop().workspacePanel
  const container = React.useRef<HTMLDivElement>(null)
  const terminal = React.useRef<Terminal | null>(null)

  React.useEffect(() => {
    const host = container.current
    if (!host) return
    const screen = new Terminal({ cursorBlink: true, fontFamily: 'Consolas, monospace', fontSize: 13, theme: { background: '#171d27' } })
    const fit = new FitAddon()
    screen.loadAddon(fit)
    screen.open(host)
    terminal.current = screen
    const input = screen.onData(data => { void api.writeTerminal(scope, id, data) })
    const resize = new ResizeObserver(() => {
      if (!host.offsetWidth || !host.offsetHeight) return
      fit.fit()
      void api.resizeTerminal(scope, id, screen.cols, screen.rows)
    })
    resize.observe(host)
    let disposed = false
    let unlisten: (() => void) | undefined
    void api.onTerminalOutput(event => {
      if (event.id !== id || event.scope.path !== scope.path || event.scope.owner?.profile !== scope.owner?.profile || event.scope.owner?.sessionId !== scope.owner?.sessionId || disposed) return
      if (event.data) screen.write(Uint8Array.from(atob(event.data), char => char.charCodeAt(0)))
      if (event.closed) screen.write('\r\n[终端已结束]')
    }).then(stop => {
      if (disposed) stop()
      else { unlisten = stop; void api.activateTerminal(scope, id).catch(() => screen.write('\r\n[终端启动失败]')) }
    }).catch(() => { if (!disposed) screen.write('\r\n[终端输出连接失败]') })
    return () => {
      disposed = true
      unlisten?.()
      resize.disconnect()
      input.dispose()
      screen.dispose()
      terminal.current = null
    }
  }, [api, id, scope])

  React.useEffect(() => { if (active) terminal.current?.focus() }, [active])
  return <div className="panel-terminal" ref={container} />
}
