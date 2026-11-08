import React from 'react'
import type { ComputerActivityApi, ComputerActivityStatus } from '@hermess/contracts'
import './computer-activity.css'

export default function ComputerActivityView({ api }: { api: ComputerActivityApi }) {
  const [status, setStatus] = React.useState<ComputerActivityStatus>()
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState(false)
  React.useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    const update = (next: ComputerActivityStatus) => {
      if (active) setStatus(current => !current || next.revision >= current.revision ? next : current)
    }
    void api.onChange(update).then(async stop => {
      if (!active) { stop(); return }
      unlisten = stop
      update(await api.read())
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; unlisten?.() }
  }, [api])
  async function stop() {
    setSending(true)
    setError(false)
    try { await api.stop() } catch { setError(true) } finally { setSending(false) }
  }
  const stopping = sending || status?.phase === 'stopping'
  return <main className="computer-activity" role="status" aria-live="polite">
    <span className="computer-activity-dot" aria-hidden="true" />
    <span className="computer-activity-label">hermess  agent desktop 正在操作电脑</span>
    <button type="button" disabled={stopping} onClick={() => void stop()}
      title={status?.shortcut || undefined}>{stopping ? '正在停止…' : '停止并接管'}</button>
    {(error || status?.phase === 'unknown') && <small role="alert">尚未确认停止，请勿接管；可重试停止。</small>}
    {status?.shortcutUnavailable && <small>停止快捷键不可用，请使用按钮。</small>}
  </main>
}
