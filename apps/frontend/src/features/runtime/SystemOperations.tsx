import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import HermesConsoleDialog from './HermesConsoleDialog'
import './system-operations.css'

type Action = 'doctor' | 'security-audit' | 'prompt-size' | 'dump' | 'config-migrate'
type ActionStatus = { id: string; running: boolean; exit_code: number | null; error: string | null; lines: string[] }
type DebugShare = { ok: boolean; urls: Record<string, string>; failures: Record<string, string>; redacted: boolean; auto_delete_seconds: number }
const actions: Action[] = ['doctor', 'security-audit', 'prompt-size', 'dump', 'config-migrate']
const emptyRecords = (): Record<Action, ActionStatus | null> => ({ doctor: null, 'security-audit': null, 'prompt-size': null, dump: null, 'config-migrate': null })

function actionText(action: Action, zh: boolean): { title: string; description: string; button: string } {
  switch (action) {
    case 'doctor': return { title: 'Hermes Doctor', description: zh ? '检查配置、工具与连接；不会自动修复。' : 'Checks configuration, tools, and connections without applying fixes.', button: zh ? '运行诊断' : 'Run doctor' }
    case 'security-audit': return { title: zh ? '安全审计' : 'Security audit', description: zh ? '扫描当前 Profile 的组件与安全问题。' : 'Scans components and security findings for this Profile.', button: zh ? '运行审计' : 'Run audit' }
    case 'prompt-size': return { title: zh ? '提示词占用' : 'Prompt size', description: zh ? '离线统计新会话的系统提示词、技能和工具 Schema 占用。' : 'Offline size breakdown of a fresh session’s prompt, skills, and tool schemas.', button: zh ? '统计占用' : 'Measure size' }
    case 'dump': return { title: zh ? '支持摘要' : 'Support summary', description: zh ? '生成当前 Profile 的本机环境摘要；默认只报告密钥是否已设置。' : 'Summarizes this Profile’s local setup; credentials are shown as set or unset.', button: zh ? '生成摘要' : 'Generate summary' }
    case 'config-migrate': return { title: zh ? '迁移配置' : 'Migrate configuration', description: zh ? '按锁定 Hermes 版本更新当前 Profile 的配置格式与默认项；可能改写配置文件。' : 'Update this Profile’s configuration format and defaults for the locked Hermes version; configuration files may be rewritten.', button: zh ? '迁移配置' : 'Migrate config' }
  }
}

function resultLabel(value: ActionStatus | null, action: Action, zh: boolean): string {
  if (!value) return zh ? '尚未运行' : 'Not run yet'
  if (value.running) return zh ? '运行中' : 'Running'
  if (value.error) return zh ? '执行失败' : 'Failed'
  if (value.exit_code === 0) return action === 'config-migrate' ? (zh ? '迁移完成' : 'Migration complete') : (zh ? '检查完成' : 'Completed')
  if (value.exit_code === 1 && (action === 'doctor' || action === 'security-audit')) return zh ? '发现问题' : 'Findings reported'
  return zh ? `退出码 ${value.exit_code ?? '未知'}` : `Exit ${value.exit_code ?? 'unknown'}`
}

export default function SystemOperations({ connected, profile, language }: {
  connected: boolean; profile: string | null; language: 'zh-CN' | 'en-US'
}) {
  const { extensions } = useDesktop()
  const zh = language === 'zh-CN'
  const [records, setRecords] = React.useState<Record<Action, ActionStatus | null>>(emptyRecords)
  const [starting, setStarting] = React.useState<Action | null>(null)
  const [error, setError] = React.useState('')
  const [shareRedact, setShareRedact] = React.useState(true)
  const [sharing, setSharing] = React.useState(false)
  const [shareResult, setShareResult] = React.useState<DebugShare | null>(null)
  const [revision, refresh] = React.useReducer(value => value + 1, 0)
  const [consoleOpen, setConsoleOpen] = React.useState(false)

  React.useEffect(() => {
    if (!connected || !profile) { setRecords(emptyRecords()); setError(''); return }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const result = await Promise.all(actions.map(action => extensions.request<ActionStatus | null>(
          { kind: 'profile', profile }, 'systemActions.status', { profile, action })))
        if (!active) return
        const next = Object.fromEntries(actions.map((action, index) => [action, result[index]])) as Record<Action, ActionStatus | null>
        setRecords(next); setError('')
        if (result.some(value => value?.running)) timer = setTimeout(() => void load(), 1200)
      } catch (cause) { if (active) setError(describeError(cause, language)) }
    }
    void load()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [connected, profile, extensions, language, revision])

  const start = async (action: Action) => {
    if (!connected || !profile || starting || records[action]?.running) return
    if (action === 'config-migrate' && !window.confirm(zh ? `确定迁移 Profile「${profile}」的配置吗？此操作可能改写配置文件。` : `Migrate configuration for Profile “${profile}”? This may rewrite configuration files.`)) return
    setStarting(action); setError('')
    try {
      const result = await extensions.request<ActionStatus>({ kind: 'profile', profile },
        'systemActions.start', { profile, action, ...(action === 'config-migrate' ? { confirmed: true } : {}) })
      setRecords(current => ({ ...current, [action]: result }))
      refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setStarting(null) }
  }

  const shareDebug = async () => {
    if (!connected || !profile || sharing) return
    const warning = shareRedact
      ? (zh ? '将脱敏后的系统摘要和日志上传到公共临时粘贴服务，约 6 小时后自动删除。确定继续？' : 'Upload a redacted system report and logs to a public temporary paste service. They expire after about 6 hours. Continue?')
      : (zh ? '将未脱敏的系统摘要和日志上传到公共临时粘贴服务，可能包含敏感信息。确定继续？' : 'Upload an unredacted system report and logs to a public temporary paste service. It may contain sensitive data. Continue?')
    if (!window.confirm(warning)) return
    setSharing(true); setShareResult(null); setError('')
    try {
      const result = await extensions.request<DebugShare>({ kind: 'profile', profile },
        'systemActions.debugShare', { profile, redact: shareRedact, lines: 200 })
      setShareResult(result)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setSharing(false) }
  }

  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url) }
    catch { setError(zh ? '复制链接失败，请手动选择链接。' : 'Could not copy the link. Select it manually.') }
  }

  return <section className="settings-panel system-operations">
    <header><div><h2>{zh ? '系统维护' : 'System maintenance'}</h2>
      <p>{zh ? '按当前 Profile 检查配置、安全状态和提示词占用，生成支持摘要或迁移配置。运行结果保留在下方。' : 'Check this Profile’s configuration, security, and prompt size, generate a support summary, or migrate its configuration. Results remain below.'}</p></div>
      <div className="system-operation-header-actions"><button type="button" disabled={!connected || !profile} onClick={() => setConsoleOpen(true)}>{zh ? '打开 Hermes Console' : 'Open Hermes Console'}</button><button type="button" disabled={!connected || !profile || !!starting} onClick={refresh}>{zh ? '刷新' : 'Refresh'}</button></div></header>
    {(!connected || !profile) && <p>{zh ? '请先连接运行时并选择 Profile。' : 'Connect the runtime and select a Profile.'}</p>}
    {error && <p role="alert" className="system-operations-error">{error}</p>}
    {actions.map(action => {
      const result = records[action]
      const { title, description, button } = actionText(action, zh)
      return <article className="system-operation" key={action}>
        <div className="system-operation-heading"><div><div className="system-operation-title"><h3>{title}</h3><span>{zh ? '当前 Profile' : 'Current Profile'}</span></div>
          <p>{description}</p></div>
          <button type="button" disabled={!connected || !profile || !!starting || !!result?.running} onClick={() => void start(action)}>{starting === action ? (zh ? '启动中…' : 'Starting…') : button}</button></div>
        <div className="system-operation-result"><span>{zh ? '状态' : 'Status'}</span>
          <strong data-state={result?.running ? 'running' : result?.error || (result?.exit_code != null && (result.exit_code > 1 || !['doctor', 'security-audit'].includes(action) && result.exit_code !== 0)) ? 'failed' : result?.exit_code === 1 ? 'findings' : 'complete'}>{resultLabel(result, action, zh)}</strong></div>
        {result?.error && <p role="alert" className="system-operations-error">{zh ? '进程未正常结束' : 'Process did not finish normally'}：{result.error}</p>}
        {result && <pre aria-label={zh ? `${title} 输出` : `${title} output`}>{result.lines.length ? result.lines.map(line => line.replace(/\u001b\[[0-9;]*m/g, '')).join('\n') : (zh ? '正在等待输出…' : 'Waiting for output…')}</pre>}
      </article>
    })}
    <article className="system-operation">
      <div className="system-operation-heading"><div><div className="system-operation-title"><h3>{zh ? '共享调试报告' : 'Share debug report'}</h3><span>{zh ? '当前 Profile' : 'Current Profile'}</span></div>
        <p>{zh ? '把系统摘要和日志上传到公共临时粘贴服务，生成可发送给支持人员的链接；约 6 小时后自动删除。' : 'Upload a system report and logs to a public temporary paste service and create support links. They expire after about 6 hours.'}</p></div>
        <button type="button" disabled={!connected || !profile || sharing} onClick={() => void shareDebug()}>{sharing ? (zh ? '上传中…' : 'Uploading…') : (zh ? '生成共享链接' : 'Generate share links')}</button></div>
      <label className="system-operation-check"><input type="checkbox" checked={shareRedact} disabled={sharing} onChange={event => setShareRedact(event.target.checked)} />{zh ? '上传前遮蔽凭据形态的内容（推荐）' : 'Redact credential-shaped content before upload (recommended)'}</label>
      {shareResult && <div className="system-debug-links" role="status">
        {Object.entries(shareResult.urls).map(([name, url]) => <div className="system-backup-export" key={name}><span>{name}：{url}</span><button type="button" onClick={() => void copyLink(url)}>{zh ? '复制链接' : 'Copy link'}</button></div>)}
        {Object.entries(shareResult.failures).map(([name, failure]) => <p className="system-operations-error" key={name}>{name}：{failure}</p>)}
      </div>}
    </article>
    {profile && <HermesConsoleDialog open={consoleOpen} profile={profile} language={language} onClose={() => setConsoleOpen(false)} />}
  </section>
}
