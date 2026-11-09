import React from 'react'
import type { RemoteGatewayConfig, WorkspaceScope } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import TerminalTab from './TerminalTab'
import './host-terminals.css'

const scope: WorkspaceScope = { kind: 'workspace', path: '' }
type Tab = { id: string; label: string }

export default function HostTerminals({ open, onHide }: { open: boolean; onHide: () => void }) {
  const { workspacePanel, runtime } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [hosts, setHosts] = React.useState<RemoteGatewayConfig[]>([])
  const [selected, setSelected] = React.useState('')
  const [active, setActive] = React.useState('')
  const [tabs, setTabs] = React.useState<Tab[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    if (!open) return
    let current = true
    void runtime.savedRemote().then(rows => {
      if (!current) return
      setHosts(rows)
      setSelected(id => rows.some(host => host.id === id && host.sshTarget) ? id : '')
    }).catch(cause => { if (current) setError(describeError(cause, language)) })
    return () => { current = false }
  }, [open, runtime, language])

  async function start() {
    setBusy(true)
    setError('')
    try {
      const { id } = await workspacePanel.startTerminal(scope, selected || undefined)
      const label = hosts.find(host => host.id === selected)?.label || (zh ? '本机' : 'This device')
      setTabs(rows => [...rows, { id, label }])
      setActive(id)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  async function close(id: string) {
    setBusy(true)
    try {
      await workspacePanel.closeTerminal(scope, id)
      const remaining = tabs.filter(row => row.id !== id)
      setTabs(remaining)
      if (id === active) setActive(remaining.at(-1)?.id || '')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  return <section className="host-terminals" data-empty={!tabs.length} hidden={!open} aria-label={zh ? '主机终端' : 'Host terminals'}>
    <header><strong>{zh ? '主机终端' : 'Host terminals'}</strong>
      <button type="button" onClick={onHide}>{zh ? '隐藏' : 'Hide'}</button>
    </header>
    <div className="host-terminal-controls">
      <select aria-label={zh ? '选择终端主机' : 'Select terminal host'} value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
        <option value="">{zh ? '本机' : 'This device'}</option>
        {hosts.map(host => <option key={host.id} value={host.id} disabled={!host.sshTarget}>{host.label}{host.sshTarget ? '' : zh ? '（待配置 SSH）' : ' (SSH not configured)'}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={() => void start()}>{zh ? '新建终端' : 'New terminal'}</button>
    </div>
    {tabs.length > 0 && <div className="host-terminal-tabs">
      {tabs.map(tab => <div key={tab.id}>
        <button type="button" aria-pressed={tab.id === active} onClick={() => setActive(tab.id)}>{tab.label}</button>
        <button type="button" disabled={busy} aria-label={zh ? `关闭 ${tab.label} 终端` : `Close ${tab.label} terminal`} onClick={() => void close(tab.id)}>×</button>
      </div>)}
    </div>}
    {error ? <p className="host-terminal-feedback" role="alert">{error}</p> : tabs.length === 0 && <p className="host-terminal-feedback">{zh ? '选择主机后打开终端。' : 'Choose a host and open a terminal.'}</p>}
    {tabs.map(tab => <div className="host-terminal-content" hidden={tab.id !== active} key={tab.id}>
      <TerminalTab scope={scope} id={tab.id} active={open && tab.id === active} />
    </div>)}
  </section>
}
