import React from 'react'
import { isDesktopFailure, type CodingPermissionDraft, type CodingPermissionSettings } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import './programming.css'
import './programmingSettings.css'

export default function ProgrammingPermissionSettings({ language, onDirtyChange, onBusyChange, onSaved, onOpenConfig }: {
  language: Language; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void; onSaved: () => void; onOpenConfig: () => void
}) {
  const { coding } = useDesktop()
  const zh = language === 'zh-CN'
  const [snapshot, setSnapshot] = React.useState<CodingPermissionSettings | null>(null)
  const [draft, setDraft] = React.useState<Omit<CodingPermissionSettings, 'profiles'> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [saved, setSaved] = React.useState(false)
  const active = React.useRef(true)
  const operation = React.useRef(false)
  const dirty = Boolean(snapshot && draft && (snapshot.default_permissions !== draft.default_permissions || snapshot.approval_policy !== draft.approval_policy || snapshot.approvals_reviewer !== draft.approvals_reviewer || snapshot.network_access !== draft.network_access || JSON.stringify(snapshot.writable_roots) !== JSON.stringify(draft.writable_roots)))
  const supportedPolicy = draft?.approval_policy === 'on-request' || draft?.approval_policy === 'never'
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  React.useEffect(() => {
    active.current = true
    return () => { active.current = false; onDirtyChange(false); onBusyChange(false) }
  }, [onDirtyChange, onBusyChange])
  const apply = (value: CodingPermissionSettings) => {
    setSnapshot(value)
    const { profiles: _profiles, profile_rules: _rules, ...fields } = value
    setDraft(fields)
  }
  const load = React.useCallback(async () => {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(null); setSaved(false)
    try {
      const value = await coding.permissionSettings()
      if (active.current) apply(value)
    } catch (cause) { if (active.current) setError(cause) }
    finally { operation.current = false; if (active.current) setBusy(false) }
  }, [coding])
  React.useEffect(() => { void load() }, [load])
  const save = async () => {
    if (!draft || (draft.approval_policy !== 'on-request' && draft.approval_policy !== 'never') || !dirty || operation.current) return
    operation.current = true; setBusy(true); setError(null); setSaved(false)
    try {
      const value = await coding.savePermissionSettings({ ...draft, approval_policy: draft.approval_policy })
      if (active.current) { apply(value); setSaved(true); onSaved() }
    } catch (cause) { if (active.current) setError(cause) }
    finally { operation.current = false; if (active.current) setBusy(false) }
  }
  const change = (fields: Partial<CodingPermissionDraft>) => { setDraft(current => current && { ...current, ...fields }); setSaved(false) }
  const labels: Record<string, string> = {
    hermess: zh ? '项目内读写（默认）' : 'Project read and write (default)',
    'hermess-readonly': zh ? '只读' : 'Read only',
    ':workspace': zh ? '项目内读写（内置方案）' : 'Project read and write (built-in)',
    ':read-only': zh ? '只读（内置方案）' : 'Read only (built-in)',
    ':danger-full-access': zh ? '完全访问' : 'Full access',
  }
  return <section className="programming-settings" aria-label={zh ? '自定义权限' : 'Custom permissions'}>
    <section className="programming-settings-section">
      <div className="programming-section-title"><div><h2>{zh ? '自定义权限' : 'Custom permissions'}</h2><p>{zh ? '所有 Profile 共用。聊天中选择“自定义”后，从下一轮任务开始生效，正在运行的任务不受影响。' : 'Shared across Profiles. Select Custom in chat to apply these settings from the next turn. Running tasks keep their current settings.'}</p></div></div>
      {draft && snapshot ? <form className="programming-connection-form programming-permission-form" onSubmit={event => { event.preventDefault(); void save() }}>
        <label>{zh ? '文件访问范围' : 'File access'}<select disabled={busy} value={draft.default_permissions} onChange={event => change({ default_permissions: event.target.value, ...snapshot.profile_rules?.[event.target.value] })}>
          {snapshot.profiles.map(id => <option key={id} value={id}>{labels[id] || (zh ? `命名方案：${id}` : `Named profile: ${id}`)}</option>)}
        </select></label>
        <label className="programming-settings-check"><input type="checkbox" disabled={busy || draft.network_access === null} checked={draft.network_access === null || Boolean(draft.network_access)} onChange={event => change({ network_access: event.target.checked })} />{zh ? '允许网络访问' : 'Allow network access'}</label>
        <label>{zh ? '额外可写目录（每行一个绝对目录）' : 'Additional writable directories (one absolute directory per line)'}<textarea disabled={busy || draft.network_access === null} value={(draft.writable_roots || []).join('\n')} onChange={event => change({ writable_roots: event.target.value.split('\n').filter(Boolean) })} /></label>
        <label>{zh ? '何时请求批准' : 'When to request approval'}<select disabled={busy} value={draft.approval_policy} onChange={event => change({ approval_policy: event.target.value as CodingPermissionDraft['approval_policy'] })}>
          <option value="on-request">{zh ? '需要扩大权限时' : 'When requesting expanded permissions'}</option>
          {!supportedPolicy && <option value={draft.approval_policy} disabled>{zh ? '旧策略不受当前运行时支持，请重新选择' : 'Legacy policy is unsupported; select another policy'}</option>}
          <option value="never">{zh ? '从不请求' : 'Never'}</option>
        </select><small>{zh ? '“从不请求”不扩大文件或网络权限；超出所选方案的操作会失败。' : 'Never does not expand file or network access. Operations outside the selected profile fail.'}</small></label>
        <label>{zh ? '审批者' : 'Approval reviewer'}<select disabled={busy || draft.approval_policy === 'never'} value={draft.approvals_reviewer} onChange={event => change({ approvals_reviewer: event.target.value as CodingPermissionDraft['approvals_reviewer'] })}>
          <option value="user">{zh ? '由我批准' : 'Me'}</option><option value="auto_review">{zh ? '自动审核' : 'Automatic reviewer'}</option>
        </select></label>
        <p className="programming-security-note">{zh ? '保存到 Hermess 独立的 config.toml，只更新所选权限项，保留其他高级配置。' : 'Saved to the separate Hermess config.toml. Only the selected permission settings are updated; other advanced settings are preserved.'}</p>
        <div className="programming-settings-actions"><button className="programming-primary" type="submit" disabled={busy || !dirty || !supportedPolicy}>{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '保存权限' : 'Save permissions')}</button></div>
      </form> : busy ? <p role="status">{zh ? '正在读取权限配置…' : 'Loading permission settings…'}</p> : null}
      {error != null && <p className="programming-error" role="alert">{isDesktopFailure(error) && error.code === 'conflict' ? (zh ? '配置已被其他操作修改，请重新读取后再保存。' : 'Settings changed elsewhere. Reload before saving again.') : describeError(error, language)}</p>}
      {saved && <p className="programming-saved" role="status">{zh ? '权限已保存。聊天中选择“自定义”后生效。' : 'Permissions saved. Select Custom in chat to use them.'}</p>}
      <button className="programming-permission-reload" type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm(zh ? '重新读取会丢弃未保存的权限修改，继续？' : 'Reload and discard unsaved permission changes?')) void load() }}>{zh ? '重新读取' : 'Reload'}</button>
      <button className="programming-permission-reload" type="button" disabled={busy || dirty} onClick={onOpenConfig}>{zh ? '编辑 config.toml' : 'Edit config.toml'}</button>
    </section>
  </section>
}
