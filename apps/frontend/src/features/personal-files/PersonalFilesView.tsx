import React from 'react'
import type { PersonalFile, PersonalFileKind } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileRef, useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { displayPath } from '../../shared/displayPath'

const tabNames: Record<PersonalFileKind, [string, string]> = {
  soul: ['人格 SOUL.md', 'Persona SOUL.md'],
  memory: ['环境记忆 MEMORY.md', 'Agent memory MEMORY.md'],
  user: ['用户资料 USER.md', 'User profile USER.md'],
}

const descriptions: Record<PersonalFileKind, [string, string]> = {
  soul: ['定义当前 Hermes 实例的身份与长期行为。保存后建议新建会话。', 'Defines this Hermes instance’s identity and lasting behavior. Start a new session after saving.'],
  memory: ['记录环境和工作流程。每条记忆由 Hermes 用 § 分隔；保存后新会话才会读取更新。', 'Stores environment and workflow facts. Hermes separates entries with §; new sessions read saved updates.'],
  user: ['记录用户背景与偏好。容量按当前配置计算；保存后新会话才会读取更新。', 'Stores user background and preferences. Capacity follows current settings; new sessions read saved updates.'],
}

function chars(value: string): number { return Array.from(value).length }

export default function PersonalFilesView({ connected, profile, epoch, onDirtyChange, onClose, initialTab }: {
  connected: boolean; profile: string | null; epoch: string | null; onDirtyChange: (dirty: boolean) => void; onClose?: () => void; initialTab?: PersonalFileKind
}) {
  const api = useDesktop().personalFiles
  const language = useLanguage()
  const index = language === 'zh-CN' ? 0 : 1
  const say = (zh: string, en: string) => language === 'zh-CN' ? zh : en
  const [tab, setTab] = useProfileState<PersonalFileKind>(workspaceKey(epoch, profile), initialTab || 'soul', 'personal-files:tab')
  React.useEffect(() => { if (initialTab) setTab(initialTab) }, [initialTab])
  const workspace = `${workspaceKey(epoch, profile)}\u0000${tab}`
  const [file, setFile] = useProfileState<PersonalFile | null>(workspace, null, 'personal-files:file')
  const [draft, setDraft] = useProfileState(workspace, '', 'personal-files:draft')
  const [entries, setEntries] = useProfileState<string[]>(workspace, [], 'personal-files:entries')
  const [busy, setBusy] = useProfileState(workspace, false, 'personal-files:busy')
  const [status, setStatus] = useProfileState(workspace, '', 'personal-files:status')
  const requestId = useProfileRef(workspace, 0)

  const dirty = tab === 'soul' ? Boolean(file && draft !== file.content)
      : Boolean(file && (entries.length !== file.entries.length || entries.some((entry, i) => entry !== file.entries[i])))

  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => () => { onDirtyChange(false) }, [onDirtyChange])

  async function load(nextTab: PersonalFileKind) {
    const request = ++requestId.current
    setStatus('')
    setBusy(true)
    if (!connected || !profile) {
      setBusy(false)
      return
    }
    try {
      const loaded = await api.read({ kind: 'profile', profile }, nextTab)
      if (request !== requestId.current) return
      setFile(loaded)
      setDraft(loaded.content)
      setEntries(loaded.entries)
    } catch (error) {
      if (request === requestId.current) setStatus(say('读取失败：', 'Read failed: ') + describeError(error, language))
    } finally {
      if (request === requestId.current) setBusy(false)
    }
  }

  React.useEffect(() => {
    if (!file) void load(tab)
    return () => { ++requestId.current }
  }, [tab, connected, profile])

  function canDiscard(): boolean {
    return !dirty || window.confirm(say('有未保存的修改，确定放弃吗？', 'Discard unsaved changes?'))
  }

  function selectTab(next: PersonalFileKind) {
    if (next === tab || !canDiscard()) return
    setTab(next)
  }

  async function save() {
    if (!dirty || busy) return
    setBusy(true)
    setStatus('')
    try {
      if (!file) return
      if (!profile) return
      const saved = await api.save({ kind: 'profile', profile }, { kind: tab, content: tab === 'soul' ? draft : undefined,
        entries: tab === 'soul' ? undefined : entries.map(entry => entry.trim()), expectedVersion: file.version })
      setFile(saved); setDraft(saved.content); setEntries(saved.entries)
      setStatus(say('已保存到磁盘。建议新建会话以加载修改。', 'Saved to disk. Start a new session to load the change.'))
    } catch (error) {
      setStatus(say('保存失败：', 'Save failed: ') + describeError(error, language))
    } finally { setBusy(false) }
  }

  const usage = entries.map(entry => entry.trim()).join('\n§\n')
  const overLimit = tab !== 'soul' && file?.limit != null && chars(usage) > file.limit
  const normalizedEntries = entries.map(entry => entry.trim())
  const invalidEntry = tab !== 'soul' && (entries.some(entry => !entry.trim() || entry.includes('\n§\n'))
    || new Set(normalizedEntries).size !== normalizedEntries.length)

  return <section className="settings-panel flat-settings-panel personal-files-panel">
    <div className="row"><h2>{say('人格与记忆', 'Persona and memory')}</h2>
      <div className="personal-files-heading-actions"><button disabled={!connected || busy} onClick={() => { if (canDiscard()) void load(tab) }}>{say('重新读取', 'Reload')}</button>
        {onClose && <button type="button" className="personal-files-close" aria-label={say('关闭记忆编辑', 'Close memory editor')} title={say('关闭', 'Close')} onClick={onClose}>×</button>}
      </div>
    </div>
    <p>{say('仅管理本桌面程序启动的 Hermes 实例。当前会话使用已缓存的提示内容；磁盘文件与会话实际内容可能不同。',
      'Manages only the Hermes instance started by this desktop app. A live session may still use a cached prompt.')} </p>
    <div className="personal-tabs" role="tablist" aria-label={say('文件类别', 'File category')}>
      {(['soul', 'memory', 'user'] as const).map(item => <button key={item} type="button" role="tab"
        aria-selected={tab === item} className={tab === item ? 'selected' : ''} onClick={() => selectTab(item)}>{tabNames[item][index]}</button>)}
    </div>
    <p className="personal-description">{descriptions[tab][index]}</p>
    {!connected && <div className="empty-panel"><h2>{say('请先启动运行时', 'Start the runtime first')}</h2></div>}
    {connected && file && <>
      <div className="personal-file-meta"><code>{displayPath(file.path)}</code><span>{file.exists ? say('文件存在', 'File exists') : say('尚未创建', 'Not created')}</span></div>
      {tab !== 'soul' && <>
        <p>{file.enabled ? say('内置记忆已启用', 'Built-in memory enabled') : say('当前配置已关闭这类内置记忆', 'This built-in memory is disabled')}
          {' · '}{chars(usage)} / {file.limit} {say('字符', 'characters')}</p>
        {entries.map((entry, i) => <div className="memory-entry" key={i}>
          <label htmlFor={`memory-entry-${i}`}>{say('条目', 'Entry')} {i + 1}</label>
          <textarea id={`memory-entry-${i}`} value={entry} disabled={busy} rows={3}
            onChange={event => setEntries(previous => previous.map((value, j) => j === i ? event.target.value : value))} />
          <button type="button" disabled={busy} onClick={() => setEntries(previous => previous.filter((_, j) => j !== i))}>{say('删除条目', 'Delete entry')}</button>
        </div>)}
        <button type="button" disabled={busy} onClick={() => setEntries(previous => [...previous, ''])}>{say('添加条目', 'Add entry')}</button>
        {overLimit && <p role="alert">{say('超过当前配置的记忆容量，请缩短内容。', 'Memory exceeds its configured capacity.')}</p>}
        {invalidEntry && <p role="alert">{say('条目不能留空、重复，也不能包含独立的 § 分隔行。', 'Entries cannot be empty, duplicated, or contain a standalone § delimiter.')}</p>}
      </>}
      {tab === 'soul' && <label className="personal-editor-label">
        {say('文件内容', 'File content')}
        <textarea className="personal-editor" value={draft} disabled={busy} spellCheck={false}
          onChange={event => setDraft(event.target.value)} />
      </label>}
      <div className="personal-actions"><button type="button" disabled={!dirty || busy || overLimit || invalidEntry} onClick={() => void save()}>
        {busy ? say('处理中…', 'Working…') : say('保存', 'Save')}</button>
        {dirty && <span>{say('有未保存修改', 'Unsaved changes')}</span>}
      </div>
    </>}
    {busy && <p role="status">{say('正在读取或保存…', 'Reading or saving…')}</p>}
    {status && <p role="status">{status}</p>}
  </section>
}
