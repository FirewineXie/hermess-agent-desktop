import React from 'react'
import type { ProfilesSnapshot, SessionManagementHealth, SessionManagementMessage, SessionManagementMessagePage } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { parseSessionImport } from './sessionImport'
import {
  buildSessionSourceFilter,
  sourceBelongsToCategory,
  sourcesForCategory,
  type SessionCategory,
  type SourceSelections,
} from './sessionSourceFilter'
import { LOCKED_SESSION_MESSAGE_LIMIT, reachedSessionMessageLimit } from './sessionMessagePage'
import { sessionHealthAlerts } from './sessionHealth'
import './sessions.css'

type Session = {
  id: string; title?: string | null; source?: string | null; preview?: string | null
  last_active?: number | null; started_at?: number | null; message_count?: number
  archived?: boolean; is_active?: boolean; model?: string | null; snippet?: string | null
}
type ListResult = { sessions: Session[]; total: number; storage?: Record<string, string> }
type SearchResult = { results: Session[] }
type Stats = { total: number; active_store: number; archived: number; messages: number; by_source: Record<string, number> }
type PrunePreview = { matched: number; skipped_open: number; sessions: { id: string; title?: string | null }[] }
type Props = {
  connected: boolean; profile: string | null; profiles: ProfilesSnapshot | null; epoch: string | null
  onSelectProfile(name: string): Promise<unknown>
  onOpenSession(profile: string, id: string): Promise<void>
  onDeleteSession(profile: string, id: string): Promise<void>
}
const scope = (profile: string) => ({ kind: 'profile' as const, profile })
const formatTime = (value?: number | null) => value ? new Date(value * 1000).toLocaleString() : '—'
function messageText(message: SessionManagementMessage) {
  const content = message.display_content ?? message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(item => typeof item === 'string' ? item : typeof item?.text === 'string' ? item.text : '').filter(Boolean).join('\n')
  return ''
}

export default function SessionsView({ connected, profile, profiles, epoch, onSelectProfile, onOpenSession, onDeleteSession }: Props) {
  const { extensions, chat } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [category, setCategory] = React.useState<SessionCategory>('all')
  const [sourceSelections, setSourceSelections] = React.useState<SourceSelections>({ all: null, chats: null, automation: null })
  const [archived, setArchived] = React.useState('exclude')
  const [draft, setDraft] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [offset, setOffset] = React.useState(0)
  const [rows, setRows] = React.useState<Session[]>([])
  const [total, setTotal] = React.useState(0)
  const [stats, setStats] = React.useState<Stats | null>(null)
  const [emptyCount, setEmptyCount] = React.useState(0)
  const [health, setHealth] = React.useState<SessionManagementHealth | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [pruneOpen, setPruneOpen] = React.useState(false)
  const [pruneDays, setPruneDays] = React.useState('90')
  const [includeArchived, setIncludeArchived] = React.useState(false)
  const [prunePreview, setPrunePreview] = React.useState<PrunePreview | null>(null)
  const [selected, setSelected] = React.useState<Session | null>(null)
  const [messagePage, setMessagePage] = React.useState<SessionManagementMessagePage | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const revision = React.useRef(0)
  const detailRevision = React.useRef(0)
  const importInput = React.useRef<HTMLInputElement>(null)
  const allSourceKey = Object.keys(stats?.by_source || {}).sort().join('\u0000')
  const allSources = React.useMemo(() => allSourceKey ? allSourceKey.split('\u0000') : [], [allSourceKey])
  const selectedSources = sourceSelections[category]
  const sourceOptions = React.useMemo(() => {
    const selected = new Set(selectedSources || [])
    return allSources.filter(source => sourceBelongsToCategory(source, category) || selected.has(source))
  }, [allSources, category, selectedSources])
  const effectiveSources = selectedSources ?? sourcesForCategory(allSources, category)
  const sourceFilter = React.useMemo(
    () => buildSessionSourceFilter(category, selectedSources, allSources),
    [allSources, category, selectedSources],
  )

  const toggleSource = (source: string) => {
    setSourceSelections(current => {
      const existing = current[category] ?? sourcesForCategory(allSources, category)
      const next = new Set(existing)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return { ...current, [category]: [...next] }
    })
  }

  const refresh = React.useCallback(async () => {
    const current = ++revision.current
    if (!connected || !profile) { setRows([]); setStats(null); setHealth(null); return }
    setLoading(true)
    try {
      const filters = { category, ...sourceFilter }
      const [listing, counts, empty, currentHealth] = await Promise.all([
        query ? extensions.request<SearchResult>(scope(profile), 'sessionManagement.search', { ...filters, q: query })
          : extensions.request<ListResult>(scope(profile), 'sessionManagement.list', { ...filters, archived, limit: 25, offset }),
        extensions.request<Stats>(scope(profile), 'sessionManagement.stats'),
        extensions.request<{ count: number }>(scope(profile), 'sessionManagement.emptyCount'),
        extensions.request<SessionManagementHealth>(scope(profile), 'sessionManagement.health'),
      ])
      if (current !== revision.current) return
      if ('results' in listing) { setRows(listing.results); setTotal(listing.results.length) }
      else {
        if (listing.storage && Object.keys(listing.storage).length) throw new Error(zh ? '会话库暂时不可读，请稍后重试。' : 'Session store is unavailable. Retry later.')
        setRows(listing.sessions); setTotal(listing.total)
      }
      setStats(counts); setEmptyCount(empty.count); setHealth(currentHealth); setError('')
    } catch (cause) {
      if (current === revision.current) setError(describeError(cause, language))
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [connected, profile, epoch, category, sourceFilter, archived, query, offset, extensions, language, zh])

  React.useEffect(() => { void refresh(); return () => { revision.current++ } }, [refresh])
  React.useEffect(() => { detailRevision.current++; setOffset(0); setSelected(null); setMessagePage(null); setSelectedIds(new Set()); setPrunePreview(null) }, [profile, category, sourceFilter, archived, query])

  const openDetail = async (session: Session) => {
    if (!profile) return
    const current = ++detailRevision.current
    setSelected(session); setMessagePage(null); setDetailLoading(true); setError('')
    try {
      const result = await extensions.request<SessionManagementMessagePage>(scope(profile), 'sessionManagement.messages', { id: session.id })
      if (current === detailRevision.current) setMessagePage(result)
    } catch (cause) { if (current === detailRevision.current) setError(describeError(cause, language)) }
    finally { if (current === detailRevision.current) setDetailLoading(false) }
  }
  const rename = async (session: Session) => {
    if (!profile || busy) return
    const title = window.prompt(zh ? '新的会话名称' : 'New session title', session.title || '')?.trim()
    if (!title || title === session.title) return
    setBusy(true); setError('')
    try {
      await extensions.request(scope(profile), 'sessionManagement.rename', { id: session.id, title })
      setNotice(zh ? '会话已重命名' : 'Session renamed'); await refresh()
      if (selected?.id === session.id) setSelected({ ...session, title })
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const setArchiveState = async (session: Session, next: boolean) => {
    if (!profile || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request(scope(profile), 'sessionManagement.archive', { id: session.id, archived: next })
      setNotice(next ? (zh ? '会话已归档，可在“仅归档”中恢复。' : 'Session archived. Restore it from “Archived only”.')
        : (zh ? '会话已恢复。' : 'Session restored.'))
      setSelected(null); setMessagePage(null); setSelectedIds(current => { const value = new Set(current); value.delete(session.id); return value })
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const remove = async (session: Session) => {
    if (!profile || busy || !window.confirm(zh ? `删除会话「${session.title || session.id}」？此操作不可撤销。` : `Delete session “${session.title || session.id}”? This cannot be undone.`)) return
    setBusy(true); setError('')
    try { await onDeleteSession(profile, session.id); if (selected?.id === session.id) { setSelected(null); setMessagePage(null) }; await refresh() }
    catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const exportSession = async (session: Session) => {
    if (!profile || busy) return
    setBusy(true); setError('')
    try {
      const saved = await chat.exportSession({ kind: 'session', profile, sessionId: session.id }, 'json', false)
      if (saved) setNotice(zh ? '会话已导出' : 'Session exported')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else if (next.size < 500) next.add(id)
      return next
    })
  }
  const selectPage = () => {
    setSelectedIds(current => {
      const next = new Set(current)
      const all = rows.every(row => next.has(row.id))
      for (const row of rows) {
        if (all) next.delete(row.id)
        else if (next.size < 500) next.add(row.id)
      }
      return next
    })
  }
  const bulkDelete = async () => {
    if (!profile || busy || selectedIds.size === 0) return
    if (!window.confirm(zh ? `永久删除 ${selectedIds.size} 个已选会话？运行中的会话会被跳过。` : `Permanently delete ${selectedIds.size} selected sessions? Active sessions will be skipped.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await extensions.request<{ deleted: number; skipped_active: string[] }>(scope(profile), 'sessionManagement.bulkDelete', { ids: [...selectedIds] })
      setSelectedIds(new Set(response.skipped_active || []))
      if (selected && !response.skipped_active?.includes(selected.id)) { setSelected(null); setMessagePage(null) }
      setNotice(zh ? `已删除 ${response.deleted} 个会话；${response.skipped_active?.length || 0} 个运行中会话被跳过。` : `Deleted ${response.deleted}; skipped ${response.skipped_active?.length || 0} active sessions.`)
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const deleteEmpty = async () => {
    if (!profile || busy || emptyCount === 0) return
    if (!window.confirm(zh ? `永久删除 ${emptyCount} 个已结束、未归档且没有消息的会话？` : `Permanently delete ${emptyCount} ended, unarchived sessions without messages?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await extensions.request<{ deleted: number }>(scope(profile), 'sessionManagement.deleteEmpty')
      setSelected(null); setMessagePage(null); setSelectedIds(new Set())
      setNotice(zh ? `已清理 ${response.deleted} 个空会话。` : `Removed ${response.deleted} empty sessions.`)
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const importFile = async (file: File | undefined) => {
    if (!file || !profile || busy) return
    setError(''); setNotice('')
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error(zh ? '导入文件不能超过 20 MB。' : 'Import file must be at most 20 MB.')
      const sessions = parseSessionImport(await file.text())
      if (!window.confirm(zh ? `向 ${profile} 导入 ${sessions.length} 个会话？已存在的会话将按 Gateway 规则处理。` : `Import ${sessions.length} sessions into ${profile}?`)) return
      setBusy(true)
      const result = await extensions.request<{ imported: number; skipped: number; detached: number }>(scope(profile), 'sessionManagement.import', { sessions })
      setNotice(zh ? `导入 ${result.imported} 个，跳过 ${result.skipped} 个，脱离缺失父会话 ${result.detached} 个。` : `Imported ${result.imported}, skipped ${result.skipped}, detached ${result.detached}.`)
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false); if (importInput.current) importInput.current.value = '' }
  }
  const prunePayload = () => {
    const days = Number(pruneDays)
    if (!Number.isInteger(days) || days < 1 || days > 36500) throw new Error(zh ? '天数必须在 1 到 36500 之间。' : 'Days must be between 1 and 36500.')
    return { days, includeArchived }
  }
  const previewPrune = async () => {
    if (!profile || busy) return
    setError(''); setPrunePreview(null); setBusy(true)
    try {
      const preview = await extensions.request<PrunePreview>(scope(profile), 'sessionManagement.prune', { ...prunePayload(), dryRun: true })
      setPrunePreview(preview)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }
  const applyPrune = async () => {
    if (!profile || busy || !prunePreview?.matched) return
    setError(''); setBusy(true)
    try {
      const payload = prunePayload()
      const current = await extensions.request<PrunePreview>(scope(profile), 'sessionManagement.prune', { ...payload, dryRun: true })
      const ids = (result: PrunePreview) => result.sessions.map(row => row.id).sort().join('\n')
      if (ids(current) !== ids(prunePreview)) {
        setPrunePreview(current)
        throw new Error(zh ? '匹配会话已变化，请检查新的预览后重试。' : 'Matching sessions changed. Review the new preview and retry.')
      }
      if (!window.confirm(zh ? `永久修剪预览中的 ${current.matched} 个会话？` : `Permanently prune ${current.matched} previewed sessions?`)) return
      const response = await extensions.request<{ removed: number; skipped_open: number }>(scope(profile), 'sessionManagement.prune', { ...payload, dryRun: false })
      setNotice(zh ? `已修剪 ${response.removed} 个会话；跳过 ${response.skipped_open} 个未结束会话。` : `Pruned ${response.removed}; skipped ${response.skipped_open} open sessions.`)
      setPrunePreview(null); setSelected(null); setMessagePage(null); setSelectedIds(new Set())
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  return <main className="sessions-page">
    <header className="sessions-heading"><div><p className="sessions-kicker">HERMESS · SESSIONS</p><h1>{zh ? '会话管理' : 'Sessions'}</h1><p>{zh ? '按 Profile 查找、检查和整理所有本地会话。' : 'Find, inspect, and manage local sessions by profile.'}</p></div><button type="button" disabled={!connected || loading} onClick={() => void refresh()}>{loading ? (zh ? '读取中…' : 'Loading…') : (zh ? '刷新' : 'Refresh')}</button></header>
    {sessionHealthAlerts(health).length > 0 && <section className="sessions-health" aria-label={zh ? '运行故障' : 'Runtime issues'}>{sessionHealthAlerts(health).map(alert => <div key={alert.key} role="alert"><strong>{alert.title}</strong>{alert.detail && <span>{alert.detail}</span>}</div>)}</section>}
    <div className="sessions-stats"><div><span>{zh ? '总会话' : 'Total'}</span><strong>{stats?.total ?? '—'}</strong></div><div><span>{zh ? '未归档' : 'Active store'}</span><strong>{stats?.active_store ?? '—'}</strong></div><div><span>{zh ? '已归档' : 'Archived'}</span><strong>{stats?.archived ?? '—'}</strong></div><div><span>{zh ? '消息' : 'Messages'}</span><strong>{stats?.messages ?? '—'}</strong></div></div>
    <div className="sessions-controls"><label>Profile <select value={profile || ''} disabled={!connected} onChange={event => { setError(''); void onSelectProfile(event.target.value).catch(cause => setError(describeError(cause, language))) }}>{(profiles?.profiles || []).map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label><label>{zh ? '类别' : 'Category'} <select value={category} onChange={event => setCategory(event.target.value as SessionCategory)}><option value="all">{zh ? '全部' : 'All'}</option><option value="chats">{zh ? '聊天' : 'Chats'}</option><option value="automation">{zh ? '自动化' : 'Automation'}</option></select></label><details className="sessions-source-filter"><summary>{zh ? '来源' : 'Sources'} · {selectedSources === null ? (zh ? '全部' : 'All') : effectiveSources.length}</summary><div><button type="button" onClick={() => setSourceSelections(current => ({ ...current, [category]: null }))}>{zh ? '恢复类别默认' : 'Reset category default'}</button>{sourceOptions.length === 0 && <span>{zh ? '暂无来源' : 'No sources yet'}</span>}{sourceOptions.map(source => <label key={source}><input type="checkbox" checked={effectiveSources.includes(source)} onChange={() => toggleSource(source)} />{source}<small>{stats?.by_source[source] ?? 0}</small></label>)}</div></details><label>{zh ? '归档' : 'Archive'} <select value={archived} onChange={event => setArchived(event.target.value)}><option value="exclude">{zh ? '未归档' : 'Unarchived'}</option><option value="only">{zh ? '仅归档' : 'Archived only'}</option><option value="include">{zh ? '全部' : 'All'}</option></select></label></div>
    <form className="sessions-search" onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); setOffset(0) }}><input value={draft} maxLength={180} aria-label={zh ? '搜索会话' : 'Search sessions'} placeholder={zh ? '搜索会话编号与消息内容' : 'Search session IDs and messages'} onChange={event => setDraft(event.target.value)} /><button type="submit">{zh ? '搜索' : 'Search'}</button>{query && <button type="button" onClick={() => { setDraft(''); setQuery('') }}>{zh ? '清除' : 'Clear'}</button>}</form>
    <div className="sessions-maintenance">
      <input ref={importInput} type="file" accept=".json,.jsonl,application/json,application/x-ndjson" hidden onChange={event => void importFile(event.currentTarget.files?.[0])} />
      <button type="button" disabled={!connected || busy} onClick={() => importInput.current?.click()}>{zh ? '导入 JSON / JSONL' : 'Import JSON / JSONL'}</button>
      <button type="button" disabled={!connected || busy || emptyCount === 0} onClick={() => void deleteEmpty()}>{zh ? `清理空会话 (${emptyCount})` : `Delete empty (${emptyCount})`}</button>
      <button type="button" disabled={!connected || busy} onClick={() => { setPruneOpen(value => !value); setPrunePreview(null) }}>{zh ? '修剪旧会话' : 'Prune old sessions'}</button>
    </div>
    {pruneOpen && <section className="sessions-prune">
      <div><strong>{zh ? '修剪已结束的旧会话' : 'Prune ended sessions'}</strong><p>{zh ? '先预览匹配项；默认不包含已归档会话，运行中的会话不会删除。' : 'Preview matches first. Archived sessions are excluded by default; open sessions are spared.'}</p></div>
      <label>{zh ? '超过天数' : 'Older than days'} <input type="number" min="1" max="36500" value={pruneDays} onChange={event => { setPruneDays(event.target.value); setPrunePreview(null) }} /></label>
      <label className="sessions-prune-check"><input type="checkbox" checked={includeArchived} onChange={event => { setIncludeArchived(event.target.checked); setPrunePreview(null) }} />{zh ? '包含已归档' : 'Include archived'}</label>
      <button type="button" disabled={busy || !connected} onClick={() => void previewPrune()}>{zh ? '预览' : 'Preview'}</button>
      {prunePreview && <div className="sessions-prune-preview"><strong>{zh ? `匹配 ${prunePreview.matched} 个；跳过 ${prunePreview.skipped_open} 个未结束会话` : `${prunePreview.matched} matches; ${prunePreview.skipped_open} open sessions spared`}</strong>{prunePreview.sessions.slice(0, 12).map(row => <span key={row.id}>{row.title || row.id}</span>)}{prunePreview.sessions.length > 12 && <small>{zh ? `另有 ${prunePreview.sessions.length - 12} 个` : `${prunePreview.sessions.length - 12} more`}</small>}<button type="button" className="danger" disabled={busy || prunePreview.matched === 0} onClick={() => void applyPrune()}>{zh ? '永久修剪匹配项' : 'Permanently prune matches'}</button></div>}
    </section>}
    {error && <div className="sessions-error" role="alert">{error}</div>}{notice && <div className="sessions-notice" role="status">{notice}</div>}
    {!connected && <div className="sessions-empty">{zh ? '请先启动本机 Gateway。' : 'Start the local Gateway first.'}</div>}
    {connected && <div className="sessions-layout"><section className="sessions-list">
      <div className="sessions-list-header"><strong>{zh ? '会话列表' : 'Session list'}</strong><span>{query ? (zh ? `${total} 个搜索结果` : `${total} results`) : (zh ? `${total} 个会话` : `${total} sessions`)}</span></div>
      <div className="sessions-selection"><button type="button" disabled={rows.length === 0 || busy} onClick={selectPage}>{rows.length > 0 && rows.every(row => selectedIds.has(row.id)) ? (zh ? '取消本页' : 'Clear page') : (zh ? '选择本页' : 'Select page')}</button><span>{zh ? `已选 ${selectedIds.size} 个` : `${selectedIds.size} selected`}</span><button type="button" className="danger" disabled={busy || selectedIds.size === 0} onClick={() => void bulkDelete()}>{zh ? '删除已选' : 'Delete selected'}</button></div>
      {rows.length === 0 && !loading && <div className="sessions-empty">{zh ? '没有匹配的会话' : 'No matching sessions'}</div>}
      {rows.map(session => <div key={session.id} className={`sessions-row ${selected?.id === session.id ? 'selected' : ''}`}>
        <input type="checkbox" aria-label={`${zh ? '选择会话' : 'Select session'} ${session.title || session.id}`} checked={selectedIds.has(session.id)} disabled={busy || (selectedIds.size >= 500 && !selectedIds.has(session.id))} onChange={() => toggleSelected(session.id)} />
        <button type="button" className="sessions-row-open" onClick={() => void openDetail(session)}><span className="sessions-row-top"><strong>{session.title && session.title !== 'Untitled' ? session.title : session.preview || session.id}</strong>{session.is_active && <em>{zh ? '运行中' : 'Live'}</em>}</span><span className="sessions-row-meta"><span>{session.source || 'local'}</span><span>{session.message_count ?? 0} {zh ? '条消息' : 'messages'}</span><span>{formatTime(session.last_active || session.started_at)}</span></span>{session.snippet && <small>{session.snippet}</small>}</button>
      </div>)}
      {!query && total > 25 && <div className="sessions-pagination"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 25))}>{zh ? '上一页' : 'Previous'}</button><span>{Math.floor(offset / 25) + 1} / {Math.ceil(total / 25)}</span><button type="button" disabled={offset + 25 >= total || loading} onClick={() => setOffset(offset + 25)}>{zh ? '下一页' : 'Next'}</button></div>}
    </section>
    <section className="sessions-detail">{!selected ? <div className="sessions-empty">{zh ? '选择一项会话查看详情和消息。' : 'Select a session to inspect its details and messages.'}</div> : <><div className="sessions-detail-head"><div><p>{selected.source || 'local'} · {selected.id}</p><h2>{selected.title || selected.preview || (zh ? '未命名会话' : 'Untitled session')}</h2><span>{formatTime(selected.last_active || selected.started_at)}</span></div><button type="button" aria-label={zh ? '关闭详情' : 'Close details'} onClick={() => { setSelected(null); setMessagePage(null) }}>×</button></div><div className="sessions-actions"><button type="button" disabled={busy} onClick={() => { if (profile) void onOpenSession(profile, selected.id) }}>{zh ? '打开会话' : 'Open'}</button><button type="button" disabled={busy} onClick={() => void rename(selected)}>{zh ? '重命名' : 'Rename'}</button><button type="button" disabled={busy} onClick={() => void exportSession(selected)}>{zh ? '导出 JSON' : 'Export JSON'}</button><button type="button" disabled={busy || selected.is_active} title={selected.is_active ? (zh ? '运行中的会话不能归档' : 'Running sessions cannot be archived') : undefined} onClick={() => void setArchiveState(selected, !selected.archived)}>{selected.archived ? (zh ? '恢复会话' : 'Restore') : (zh ? '归档会话' : 'Archive')}</button><button type="button" disabled={busy} className="danger" onClick={() => void remove(selected)}>{zh ? '删除' : 'Delete'}</button></div><div className="sessions-messages"><h3>{zh ? '最近消息' : 'Recent messages'}</h3>{detailLoading && <p>{zh ? '读取中…' : 'Loading…'}</p>}{messagePage?.messages.length === 0 && <p>{zh ? '此会话暂无消息' : 'No messages'}</p>}{reachedSessionMessageLimit(messagePage?.pagination) && <p role="status">{zh ? `已显示接收端允许的最近 ${LOCKED_SESSION_MESSAGE_LIMIT} 条消息；可能还有更早内容，请打开会话查看完整上下文。` : `Showing the latest ${LOCKED_SESSION_MESSAGE_LIMIT} messages allowed by the receiver. Earlier content may exist; open the session for the full context.`}</p>}{messagePage?.messages.map((message, index) => <article key={index}><span>{message.role || 'message'}</span><p>{messageText(message) || (zh ? '非文本内容' : 'Non-text content')}</p></article>)}</div></>}</section></div>}
  </main>
}
