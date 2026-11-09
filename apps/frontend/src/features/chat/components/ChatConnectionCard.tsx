import React from 'react'
import type { ChatConnectionCommand, ChatConnectionSnapshot, ChatConnectionTarget } from '@hermess/contracts'
import { describeError } from '../../../app/desktopErrors'

type Props = {
  snapshot: ChatConnectionSnapshot
  language: 'zh-CN' | 'en-US'
  onAction: (request: ChatConnectionCommand) => Promise<void>
  onDismiss: () => void
}

function TargetRow({ row, disabled, settled, zh, perform }: {
  row: ChatConnectionTarget
  disabled: boolean
  settled: boolean
  zh: boolean
  perform: (action: 'approve' | 'skip' | 'open' | 'retry', env?: Record<string, string>) => Promise<boolean>
}) {
  const [inputs, setInputs] = React.useState<Record<string, string>>({})
  const fields = row.required_env ?? []
  const canApprove = !settled && row.kind !== 'connector' && ['pending', 'failed', 'expired'].includes(row.state)
  const env = () => Object.fromEntries(fields.flatMap(field => {
    const value = inputs[field.name] ?? field.default
    return value && (!field.secret || inputs[field.name] !== undefined) ? [[field.name, value]] : []
  }))
  const missing = fields.some(field => field.required && !(inputs[field.name] ?? (field.secret ? '' : field.default)).trim())
  const state = {
    pending: zh ? '待确认' : 'Awaiting confirmation',
    initiated: zh ? '处理中' : 'In progress',
    connected: row.kind === 'plugin' || row.kind === 'skill' ? (zh ? '已安装' : 'Installed') : (zh ? '已连接' : 'Connected'),
    skipped: zh ? '已跳过' : 'Skipped',
    failed: zh ? '失败' : 'Failed',
    expired: zh ? '已过期' : 'Expired',
    not_connected: zh ? '未完成' : 'Incomplete',
  }[row.state]
  return <section className="request-question">
    <strong>{row.display || row.name}</strong>
    <p>{[row.tier, state, row.phase].filter(Boolean).join(' · ')}</p>
    {row.description && <p>{row.description}</p>}
    {row.target_profile && <p>Profile · {row.target_profile}</p>}
    {row.repo && <p>{row.repo}</p>}
    {row.sha && <code>{row.sha}</code>}
    {row.scan && <p>{zh ? '扫描结果' : 'Scan result'} · {row.scan.status} · {row.scan.summary}</p>}
    {row.launch && <pre className="request-command">{[row.launch.target, row.launch.cwd, row.launch.env?.join(', ')].filter(Boolean).join('\n')}</pre>}
    {row.instructions && <p>{row.instructions}</p>}
    {row.detail && <p>{row.detail}</p>}
    {row.enabled === false && row.state === 'connected' && <p>{zh ? '已安装，尚未启用' : 'Installed, disabled'}</p>}
    {!!row.missing_env?.length && <p>{zh ? '待配置' : 'Needs configuration'} · {row.missing_env.join(', ')}</p>}
    {row.server_errors?.map(error => <p key={error.name}>{error.name} · {error.error}</p>)}
    {canApprove && fields.map(field => <label className="request-supplement" key={field.name}>
      <span>{field.prompt || field.name}{field.required ? ' *' : ''}</span>
      <input className="request-freeform" type={field.secret ? 'password' : 'text'} autoComplete="off"
        value={inputs[field.name] ?? (field.secret ? '' : field.default)}
        onChange={event => setInputs(current => ({ ...current, [field.name]: event.target.value }))} />
    </label>)}
    {!settled && <div className="request-card-actions">
      {canApprove && <button type="button" disabled={disabled || missing}
        onClick={() => void perform('approve', env()).then(ok => { if (ok) setInputs({}) })}>
        {row.state !== 'pending' ? (zh ? '重试' : 'Retry')
          : row.kind === 'plugin' ? (zh ? '安装并启用' : 'Install and enable')
            : (zh ? '确认' : 'Approve')}
      </button>}
      {row.connect_url && row.state === 'initiated' && <button type="button" disabled={disabled}
        onClick={() => void perform('open')}>{zh ? '在浏览器授权' : 'Authorize in browser'}</button>}
      {row.kind === 'connector' && ['failed', 'expired'].includes(row.state) && <button type="button" disabled={disabled}
        onClick={() => void perform('retry')}>{zh ? '重新发起连接' : 'Retry connection'}</button>}
      {!row.resolved && !['connected', 'skipped', 'not_connected'].includes(row.state) && <button type="button" disabled={disabled}
        onClick={() => void perform('skip')}>{zh ? '跳过' : 'Skip'}</button>}
    </div>}
  </section>
}

export default function ChatConnectionCard({ snapshot, language, onAction, onDismiss }: Props) {
  const zh = language === 'zh-CN'
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [said, setSaid] = React.useState('')
  const [expired, setExpired] = React.useState(false)
  const busyRef = React.useRef(false)
  const { op_id, settled, deadline_at } = snapshot
  React.useEffect(() => {
    setExpired(false)
    if (settled) return
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, deadline_at * 1000 - Date.now()))
    return () => window.clearTimeout(timer)
  }, [deadline_at, settled])

  async function perform(request: ChatConnectionCommand): Promise<boolean> {
    if (busyRef.current || settled || expired) return false
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await onAction(request)
      return true
    } catch (cause) {
      setError(describeError(cause, language))
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const title = snapshot.display ? (zh ? '连接应用' : 'Connect apps') : (zh ? '安装与连接确认' : 'Installation and connection')
  const ended = Boolean(settled || expired)
  const summary = settled ? ({
    all_resolved: zh ? '已结束' : 'Finished',
    continue: zh ? '已继续会话' : 'Conversation continued',
    deadline: zh ? '操作已超时' : 'Operation timed out',
    interrupt: zh ? '操作已停止' : 'Operation stopped',
  }[snapshot.settled_by || ''] ?? (zh ? '已结束' : 'Finished')) : expired ? (zh ? '操作已超时' : 'Operation timed out') : (zh ? '请检查以下操作' : 'Review the requested actions')
  return <div className="request-card request-card-approval" role="group" aria-label={title}>
    <header className="request-card-header"><div><strong>{title}</strong><p role="status">{summary}</p></div></header>
    <div className="request-question-list">
      {snapshot.targets.map(row => <TargetRow key={row.name} row={row} disabled={busy} settled={ended} zh={zh}
        perform={(action, env) => action === 'open' || action === 'retry'
          ? perform({ op_id, action, name: row.name })
          : perform({ op_id, action: 'respond', answer: { targets: [{ name: row.name, status: action === 'skip' ? 'skipped' : 'approved', env }] } })} />)}
      {snapshot.display && <><p>{snapshot.display.suggested.join(' · ')}</p>
        {!ended && <input className="request-freeform" value={said} maxLength={4000} disabled={busy}
          aria-label={zh ? '回复连接建议' : 'Reply to connector suggestions'} onChange={event => setSaid(event.target.value)} />}</>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="request-card-actions">
      {ended ? <button type="button" onClick={onDismiss}>{zh ? '关闭' : 'Close'}</button> : <>
        {error && <button type="button" disabled={busy} onClick={() => void perform({ op_id, action: 'status' })}>
          {zh ? '刷新状态' : 'Refresh status'}
        </button>}
        {snapshot.targets.some(row => row.connect_url && row.state === 'initiated') && <button type="button" disabled={busy}
          onClick={() => void perform({ op_id, action: 'wake' })}>{zh ? '检查授权结果' : 'Check authorization'}</button>}
        <button type="button" disabled={busy} onClick={() => void perform({ op_id, action: 'respond',
          answer: { settled_by: 'continue', ...(snapshot.display && said.trim() ? { said: said.trim() } : {}) } })}>
          {zh ? '继续会话' : 'Continue'}
        </button>
      </>}
    </div>
  </div>
}
