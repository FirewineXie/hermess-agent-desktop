import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

const sources = [
  ['openclaw', 'OpenClaw'], ['claude-code', 'Claude Code'], ['codex', 'Codex CLI'],
  ['cursor', 'Cursor'], ['grok-bot', 'Grok Bot'], ['openbot', 'OpenBot'],
] as const
type Source = typeof sources[number][0]
type Report = { ok: boolean; report: string }

export default function AgentMigrationDialog({ profiles, disabled }: { profiles: ProfilesSnapshot | null; disabled: boolean }) {
  const { extensions, nativeFiles } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const dialog = React.useRef<HTMLDialogElement>(null)
  const [source, setSource] = React.useState<Source>('openclaw')
  const [profile, setProfile] = React.useState('')
  const [path, setPath] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<Report | null>(null)
  const [applied, setApplied] = React.useState(false)
  const [error, setError] = React.useState('')
  const served = new Set(profiles?.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles ?? [])]))
  const targets = profiles?.profiles.filter(item => served.has(item.name)) ?? []

  function clearReport() { setResult(null); setApplied(false); setError('') }

  async function choose(directory: boolean) {
    if (busy) return
    try {
      const selected = await nativeFiles.choose({ directory, multiple: false, title: zh ? '选择迁移来源' : 'Select the migration source' })
      if (typeof selected === 'string') { setPath(selected); clearReport() }
    } catch (cause) { setError(describeError(cause, language)) }
  }

  async function run(apply: boolean) {
    if (busy || disabled || !served.has(profile) || !path || (apply && !result?.ok)) return
    setBusy(true); setError('')
    try {
      const report = await extensions.request<Report>({ kind: 'profile', profile }, apply ? 'agent.migration.apply' : 'agent.migration.preview', { source, path })
      setResult(report)
      setApplied(apply)
      if (!report.ok) setError(zh ? '导入器未完成此操作。请查看报告。' : 'The importer did not complete. Check the report.')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  const canImport = !!result?.ok && !applied
  return <>
    <button type="button" className="profile-directory-import" disabled={disabled || targets.length === 0} onClick={() => {
      setProfile(targets.find(item => item.name === profiles?.selected)?.name || targets[0]?.name || '')
      setPath(''); clearReport(); dialog.current?.showModal()
    }}>{zh ? '从其他 Agent 迁移' : 'Migrate from another agent'}</button>
    <dialog ref={dialog} className="expert-create-modal agent-migration-dialog" aria-labelledby="agent-migration-title"
      onCancel={event => { if (busy) event.preventDefault() }}>
      <form onSubmit={event => { event.preventDefault(); void run(false) }}>
        <header><h2 id="agent-migration-title">{zh ? '从其他 Agent 迁移' : 'Migrate from another agent'}</h2></header>
        <div className="expert-modal-body">
          <label className="expert-name-field">{zh ? '迁移来源' : 'Source'}<select value={source} disabled={busy} onChange={event => {
            setSource(event.target.value as Source); setPath(''); clearReport()
          }}>{sources.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
          <label className="expert-name-field">{zh ? '迁入 Profile' : 'Destination Profile'}<select value={profile} disabled={busy} onChange={event => {
            setProfile(event.target.value); clearReport()
          }}>{targets.map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label>
          {source === 'grok-bot' && <p>{zh ? '选择 Grok Bot 自导出的文件，或存放导出文件的目录。' : 'Select a Grok Bot export file or a folder containing exports.'}</p>}
          {source === 'openbot' && <p>{zh ? '选择 OpenBot 用户数据目录或 openbot.db 文件。' : 'Select the OpenBot data folder or the openbot.db file.'}</p>}
          <div className="row">
            <button type="button" className="dialog-secondary-action" disabled={busy} onClick={() => void choose(true)}>{zh ? '选择目录' : 'Choose folder'}</button>
            {source === 'grok-bot' && <button type="button" className="dialog-secondary-action" disabled={busy} onClick={() => void choose(false)}>{zh ? '选择导出文件' : 'Choose export file'}</button>}
            {source === 'openbot' && <button type="button" className="dialog-secondary-action" disabled={busy} onClick={() => void choose(false)}>{zh ? '选择数据库' : 'Choose database'}</button>}
          </div>
          {path && <p className="agent-migration-path">{path}</p>}
          <p>{zh ? '首次预览会由 Hermes 安装或启用官方导入器。确认后按预览迁入，保留现有冲突项，导入的定时任务保持暂停。'
            : 'The first preview installs or enables the official importer through Hermes. Existing conflicts are kept and imported schedules stay paused.'}</p>
          {busy && <p role="status">{zh ? 'Hermes 导入器运行中…' : 'The Hermes importer is running…'}</p>}
          {result?.report && <pre className="agent-migration-report">{result.report}</pre>}
          {error && <p role="alert" className="expert-create-error">{error}</p>}
        </div>
        <div className="agent-migration-actions">
          <button type="button" className="dialog-secondary-action" disabled={busy} onClick={() => dialog.current?.close()}>{zh ? '关闭' : 'Close'}</button>
          <button type="submit" className={canImport ? 'dialog-secondary-action' : 'dialog-primary-action'} disabled={busy || disabled || !path || !served.has(profile)}>{zh ? '预览迁移' : 'Preview migration'}</button>
          {canImport && <button type="button" className="dialog-primary-action" disabled={busy || disabled || !served.has(profile)} onClick={() => void run(true)}>{zh ? '确认迁入' : 'Confirm import'}</button>}
        </div>
      </form>
    </dialog>
  </>
}
