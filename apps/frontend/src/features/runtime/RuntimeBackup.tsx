import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import './system-operations.css'

type BackupStatus = { id: string; running: boolean; exit_code: number | null; error: string | null; lines: string[]; archive: string | null; subject?: string | null }

// The locked Hermes backup command reads HERMES_HOME, regardless of the selected Profile.
const profile = 'default'
const scope = { kind: 'profile' as const, profile }
const payload = { profile, action: 'backup' }
const restorePayload = { profile, action: 'restore' }

export default function RuntimeBackup({ connected }: { connected: boolean }) {
  const { extensions, nativeFiles } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [record, setRecord] = React.useState<BackupStatus | null>(null)
  const [restoreRecord, setRestoreRecord] = React.useState<BackupStatus | null>(null)
  const [restoreArchive, setRestoreArchive] = React.useState('')
  const [starting, setStarting] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [exportedPath, setExportedPath] = React.useState('')
  const [error, setError] = React.useState('')
  const [revision, refresh] = React.useReducer(value => value + 1, 0)

  React.useEffect(() => {
    if (!connected) { setRecord(null); setRestoreRecord(null); setError(''); return }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const [result, restore] = await Promise.all([
          extensions.request<BackupStatus | null>(scope, 'systemActions.status', payload),
          extensions.request<BackupStatus | null>(scope, 'systemActions.status', restorePayload),
        ])
        if (!active) return
        setRecord(result); setRestoreRecord(restore); setError('')
        if (result?.running || restore?.running) timer = setTimeout(() => void load(), 1200)
      } catch (cause) { if (active) setError(describeError(cause, language)) }
    }
    void load()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [connected, extensions, language, revision])

  const start = async () => {
    if (!connected || starting || record?.running || restoreRecord?.running) return
    setStarting(true); setError(''); setExportedPath('')
    try {
      const result = await extensions.request<BackupStatus>(scope, 'systemActions.start', payload)
      setRecord(result); refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setStarting(false) }
  }

  const exportBackup = async () => {
    if (!connected || !record?.archive || record.running || record.exit_code !== 0 || record.error || exporting) return
    setExporting(true); setError('')
    try {
      const destination = await nativeFiles.save(record.archive)
      if (!destination) return
      const result = await extensions.request<{ path: string; bytes: number }>(scope,
        'systemActions.exportBackup', { ...payload, id: record.id, destination })
      setExportedPath(result.path)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setExporting(false) }
  }

  const chooseRestore = async () => {
    setError('')
    try {
      const selected = await nativeFiles.choose({ directory: false, multiple: false, title: zh ? '选择完整备份 ZIP' : 'Choose full backup ZIP' })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (path) setRestoreArchive(path)
    } catch (cause) { setError(describeError(cause, language)) }
  }

  const startRestore = async () => {
    if (!connected || !restoreArchive || starting || record?.running || restoreRecord?.running) return
    const confirmed = window.confirm(zh
      ? '恢复会覆盖当前全部 Profile 的配置、技能、会话和数据。此操作不可撤销。确定继续？'
      : 'Restore overwrites configuration, Skills, sessions, and data for every Profile. This cannot be undone. Continue?')
    if (!confirmed) return
    setStarting(true); setError('')
    try {
      const result = await extensions.request<BackupStatus>(scope, 'systemActions.start', {
        ...restorePayload, archive: restoreArchive, confirmed: true,
      })
      setRestoreRecord(result); refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setStarting(false) }
  }

  const status = !record ? (zh ? '尚未运行' : 'Not run yet')
    : record.running ? (zh ? '运行中' : 'Running')
      : record.error ? (zh ? '执行失败' : 'Failed')
        : record.exit_code === 0 ? (zh ? '备份完成' : 'Backup complete')
          : (zh ? `退出码 ${record.exit_code ?? '未知'}` : `Exit ${record.exit_code ?? 'unknown'}`)
  const restoreStatus = !restoreRecord ? (zh ? '尚未恢复' : 'Not restored')
    : restoreRecord.running ? (zh ? '恢复中' : 'Restoring')
      : restoreRecord.error ? (zh ? '恢复失败' : 'Restore failed')
        : restoreRecord.exit_code === 0 ? (zh ? '恢复完成，请重启运行时' : 'Restore complete; restart the runtime')
          : (zh ? `退出码 ${restoreRecord.exit_code ?? '未知'}` : `Exit ${restoreRecord.exit_code ?? 'unknown'}`)

  return <section className="system-operations" aria-label={zh ? '完整数据备份' : 'Full data backup'}>
    <article className="system-operation">
      <div className="system-operation-heading"><div>
        <div className="system-operation-title"><h3>{zh ? '完整数据备份' : 'Full data backup'}</h3>
          <span>{zh ? '全局 · 所有 Profile' : 'Global · all Profiles'}</span></div>
        <p>{zh ? '归档本产品管理的 Hermes 根目录，包含所有 Profile；备份可能包含凭据。' : 'Archive this app’s Hermes root, including every Profile; the archive may contain credentials.'}</p>
      </div><button type="button" disabled={!connected || starting || !!record?.running || !!restoreRecord?.running} onClick={() => void start()}>{starting ? (zh ? '启动中…' : 'Starting…') : (zh ? '创建备份' : 'Create backup')}</button></div>
      {!connected && <p role="status">{zh ? '连接运行时后可创建备份。' : 'Connect the runtime to create a backup.'}</p>}
      {error && <p role="alert" className="system-operations-error">{error}</p>}
      <div className="system-operation-result"><span>{zh ? '状态' : 'Status'}</span>
        <strong data-state={record?.running ? 'running' : record?.error || (record?.exit_code != null && record.exit_code !== 0) ? 'failed' : 'complete'}>{status}</strong></div>
      {record?.error && <p role="alert" className="system-operations-error">{zh ? '进程未正常结束' : 'Process did not finish normally'}：{record.error}</p>}
      {record?.archive && <div className="system-backup-export"><span>{record.archive}</span>
        <button type="button" disabled={record.running || record.exit_code !== 0 || !!record.error || exporting} onClick={() => void exportBackup()}>{exporting ? (zh ? '保存中…' : 'Saving…') : (zh ? '下载备份' : 'Download backup')}</button></div>}
      {exportedPath && <p role="status">{zh ? '备份已保存到：' : 'Backup saved to: '}{exportedPath}</p>}
      {record && <pre aria-label={zh ? '备份输出' : 'Backup output'}>{record.lines.length ? record.lines.map(line => line.replace(/\u001b\[[0-9;]*m/g, '')).join('\n') : (zh ? '正在等待输出…' : 'Waiting for output…')}</pre>}
    </article>
    <article className="system-operation">
      <div className="system-operation-heading"><div>
        <div className="system-operation-title"><h3>{zh ? '从完整备份恢复' : 'Restore full backup'}</h3>
          <span>{zh ? '全局 · 所有 Profile' : 'Global · all Profiles'}</span></div>
        <p>{zh ? '选择本机 ZIP。恢复会覆盖当前配置、技能、会话和数据，完成后需要重启运行时。' : 'Choose a local ZIP. Restore overwrites current configuration, Skills, sessions, and data; restart the runtime afterward.'}</p>
      </div><button type="button" disabled={starting || !!record?.running || !!restoreRecord?.running} onClick={() => void chooseRestore()}>{zh ? '选择备份 ZIP' : 'Choose backup ZIP'}</button></div>
      {restoreArchive && <div className="system-backup-export"><span>{restoreArchive}</span>
        <button type="button" disabled={!connected || starting || !!record?.running || !!restoreRecord?.running} onClick={() => void startRestore()}>{starting ? (zh ? '启动中…' : 'Starting…') : (zh ? '确认并恢复' : 'Confirm and restore')}</button></div>}
      <div className="system-operation-result"><span>{zh ? '状态' : 'Status'}</span>
        <strong data-state={restoreRecord?.running ? 'running' : restoreRecord?.error || (restoreRecord?.exit_code != null && restoreRecord.exit_code !== 0) ? 'failed' : 'complete'}>{restoreStatus}</strong></div>
      {restoreRecord?.error && <p role="alert" className="system-operations-error">{zh ? '恢复进程未正常结束' : 'Restore process did not finish normally'}：{restoreRecord.error}</p>}
      {restoreRecord?.subject && <p>{zh ? '恢复来源：' : 'Restore source: '}{restoreRecord.subject}</p>}
      {restoreRecord && <pre aria-label={zh ? '恢复输出' : 'Restore output'}>{restoreRecord.lines.length ? restoreRecord.lines.map(line => line.replace(/\u001b\[[0-9;]*m/g, '')).join('\n') : (zh ? '正在等待输出…' : 'Waiting for output…')}</pre>}
    </article>
  </section>
}
