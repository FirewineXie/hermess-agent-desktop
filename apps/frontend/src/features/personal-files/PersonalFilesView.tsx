import React from 'react'
import type { EditableFile, PersonalFile, PersonalFileKind, ProjectFile } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { displayPath } from '../../shared/displayPath'

type Tab = PersonalFileKind | 'project'

const tabNames: Record<Tab, [string, string]> = {
  soul: ['人格 SOUL.md', 'Persona SOUL.md'],
  memory: ['环境记忆 MEMORY.md', 'Agent memory MEMORY.md'],
  user: ['用户资料 USER.md', 'User profile USER.md'],
  project: ['项目指令', 'Project instructions'],
}

const descriptions: Record<Tab, [string, string]> = {
  soul: ['定义当前 Hermes 实例的身份与长期行为。保存后建议新建会话。', 'Defines this Hermes instance’s identity and lasting behavior. Start a new session after saving.'],
  memory: ['记录环境和工作流程。每条记忆由 Hermes 用 § 分隔；保存后新会话才会读取更新。', 'Stores environment and workflow facts. Hermes separates entries with §; new sessions read saved updates.'],
  user: ['记录用户背景与偏好。容量按当前配置计算；保存后新会话才会读取更新。', 'Stores user background and preferences. Capacity follows current settings; new sessions read saved updates.'],
  project: ['依据当前会话工作目录列出 Hermes 发现的指令文件。加载状态是当前清单的判断，修改后建议新建会话。', 'Lists instructions Hermes discovers for the current session workspace. Start a new session after editing.'],
}

const statusNames: Record<string, [string, string]> = {
  loaded: ['已加载', 'Loaded'], truncated: ['已加载，但被截断', 'Loaded, truncated'],
  flagged: ['已加载，需检查', 'Loaded, review'], shadowed: ['被更高优先级文件遮蔽', 'Shadowed'],
  blocked: ['未加载，已拦截', 'Blocked'], empty: ['空文件', 'Empty'],
  unreadable: ['无法读取', 'Unreadable'], suppressed: ['未加载', 'Suppressed'],
}

function chars(value: string): number { return Array.from(value).length }

export default function PersonalFilesView({ connected, sessionId, onDirtyChange }: {
  connected: boolean; sessionId: string; onDirtyChange: (dirty: boolean) => void
}) {
  const api = useDesktop().personalFiles
  const language = useLanguage()
  const index = language === 'zh-CN' ? 0 : 1
  const say = (zh: string, en: string) => language === 'zh-CN' ? zh : en
  const [tab, setTab] = React.useState<Tab>('soul')
  const [file, setFile] = React.useState<PersonalFile | null>(null)
  const [draft, setDraft] = React.useState('')
  const [entries, setEntries] = React.useState<string[]>([])
  const [projectFiles, setProjectFiles] = React.useState<ProjectFile[]>([])
  const [projectPath, setProjectPath] = React.useState('')
  const [projectFile, setProjectFile] = React.useState<EditableFile | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const requestId = React.useRef(0)

  const dirty = tab === 'project' ? Boolean(projectFile && draft !== projectFile.content)
    : tab === 'soul' ? Boolean(file && draft !== file.content)
      : Boolean(file && (entries.length !== file.entries.length || entries.some((entry, i) => entry !== file.entries[i])))

  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => () => { onDirtyChange(false) }, [onDirtyChange])

  const load = React.useCallback(async (nextTab: Tab, nextProjectPath = '') => {
    const request = ++requestId.current
    setStatus('')
    setBusy(true)
    if (!connected) {
      setFile(null); setProjectFile(null); setProjectFiles([]); setBusy(false)
      return
    }
    try {
      if (nextTab === 'project') {
        if (!sessionId) {
          setProjectFiles([]); setProjectFile(null); setProjectPath('')
          return
        }
        const files = await api.listProject(sessionId)
        if (request !== requestId.current) return
        setProjectFiles(files)
        const selected = files.find(item => item.path === nextProjectPath)?.path || files[0]?.path || ''
        setProjectPath(selected)
        const loaded = selected ? await api.readProject(sessionId, selected) : null
        if (request !== requestId.current) return
        setProjectFile(loaded)
        setDraft(loaded?.content || '')
      } else {
        const loaded = await api.read(nextTab)
        if (request !== requestId.current) return
        setFile(loaded)
        setDraft(loaded.content)
        setEntries(loaded.entries)
      }
    } catch (error) {
      if (request === requestId.current) setStatus(say('读取失败：', 'Read failed: ') + describeError(error, language))
    } finally {
      if (request === requestId.current) setBusy(false)
    }
  }, [api, connected, sessionId, language])

  React.useEffect(() => {
    void load(tab, projectPath)
    return () => { ++requestId.current }
  }, [tab, connected, sessionId])

  function canDiscard(): boolean {
    return !dirty || window.confirm(say('有未保存的修改，确定放弃吗？', 'Discard unsaved changes?'))
  }

  function selectTab(next: Tab) {
    if (next === tab || !canDiscard()) return
    setFile(null); setProjectFile(null); setDraft(''); setEntries([])
    setTab(next)
  }

  async function selectProject(path: string) {
    if (path === projectPath || !canDiscard()) return
    setProjectPath(path)
    setProjectFile(null)
    setDraft('')
    await load('project', path)
  }

  async function save() {
    if (!dirty || busy) return
    setBusy(true)
    setStatus('')
    try {
      if (tab === 'project') {
        if (!projectFile) return
        const saved = await api.saveProject({ sessionId, path: projectFile.path, content: draft, expectedVersion: projectFile.version })
        setProjectFile(saved); setDraft(saved.content)
      } else {
        if (!file) return
        const saved = await api.save({ kind: tab, content: tab === 'soul' ? draft : undefined,
          entries: tab === 'soul' ? undefined : entries.map(entry => entry.trim()), expectedVersion: file.version })
        setFile(saved); setDraft(saved.content); setEntries(saved.entries)
      }
      setStatus(say('已保存到磁盘。建议新建会话以加载修改。', 'Saved to disk. Start a new session to load the change.'))
    } catch (error) {
      setStatus(say('保存失败：', 'Save failed: ') + describeError(error, language))
    } finally { setBusy(false) }
  }

  const usage = entries.map(entry => entry.trim()).join('\n§\n')
  const overLimit = tab !== 'soul' && tab !== 'project' && file?.limit != null && chars(usage) > file.limit
  const normalizedEntries = entries.map(entry => entry.trim())
  const invalidEntry = tab !== 'soul' && tab !== 'project' && (entries.some(entry => !entry.trim() || entry.includes('\n§\n'))
    || new Set(normalizedEntries).size !== normalizedEntries.length)
  const current = tab === 'project' ? projectFile : file

  return <section className="settings-panel flat-settings-panel personal-files-panel">
    <div className="row"><h2>{say('人格与记忆', 'Persona and memory')}</h2>
      <button disabled={!connected || busy} onClick={() => { if (canDiscard()) void load(tab, projectPath) }}>{say('重新读取', 'Reload')}</button>
    </div>
    <p>{say('仅管理本桌面程序启动的 Hermes 实例。当前会话使用已缓存的提示内容；磁盘文件与会话实际内容可能不同。',
      'Manages only the Hermes instance started by this desktop app. A live session may still use a cached prompt.')} </p>
    <div className="personal-tabs" role="tablist" aria-label={say('文件类别', 'File category')}>
      {(['soul', 'memory', 'user', 'project'] as const).map(item => <button key={item} type="button" role="tab"
        aria-selected={tab === item} className={tab === item ? 'selected' : ''} onClick={() => selectTab(item)}>{tabNames[item][index]}</button>)}
    </div>
    <p className="personal-description">{descriptions[tab][index]}</p>
    {!connected && <div className="empty-panel"><h2>{say('请先启动运行时', 'Start the runtime first')}</h2></div>}
    {connected && tab === 'project' && <>
      {!sessionId && <p>{say('请先创建或恢复一个会话。', 'Create or resume a session first.')}</p>}
      {sessionId && !busy && projectFiles.length === 0 && <p>{say('当前会话没有可列出的项目指令文件；会话尚未建立 Agent 时也可能为空。',
        'No project instruction files are available. The list may also be empty before this session creates an agent.')}</p>}
      {projectFiles.length > 0 && <div className="project-file-list" aria-label={say('项目指令文件', 'Project instruction files')}>
        {projectFiles.map(item => <button key={item.path} className={projectPath === item.path ? 'selected' : ''}
          title={displayPath(item.path)} onClick={() => void selectProject(item.path)}>
          <strong>{item.label}</strong><small>{(statusNames[item.status] || [item.status, item.status])[index]}</small>
        </button>)}
      </div>}
    </>}
    {connected && current && <>
      <div className="personal-file-meta"><code>{displayPath(current.path)}</code><span>{current.exists ? say('文件存在', 'File exists') : say('尚未创建', 'Not created')}</span></div>
      {tab !== 'project' && tab !== 'soul' && file && <>
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
      {(tab === 'soul' || tab === 'project') && <label className="personal-editor-label">
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
