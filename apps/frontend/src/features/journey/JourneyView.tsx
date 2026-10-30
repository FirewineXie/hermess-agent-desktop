import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import './JourneyView.css'

type JourneyNode = {
  id: string
  label: string
  kind: 'skill' | 'memory'
  category: string
  timestamp?: number | null
  useCount: number
}

type JourneyGraph = {
  nodes: JourneyNode[]
  edges: { source: string; target: string }[]
}

type JourneyDetail = { ok: boolean; id: string; kind: string; label: string; content: string }

export default function JourneyView({ connected, profile, epoch, embedded = false }: { connected: boolean; profile: string | null; epoch: string | null; embedded?: boolean }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [graph, setGraph] = React.useState<JourneyGraph | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [selected, setSelected] = React.useState<JourneyDetail | null>(null)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const editorRef = React.useRef<HTMLTextAreaElement>(null)
  const detailRef = React.useRef<HTMLElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const context = `${profile ?? ''}:${epoch ?? ''}`
  const contextRef = React.useRef(context)
  contextRef.current = context
  const [revision, refresh] = React.useReducer(value => value + 1, 0)

  React.useEffect(() => {
    setGraph(null)
    setError('')
    setSelected(null)
    setDraft('')
    if (!connected || !profile) { setLoading(false); return }
    let current = true
    setLoading(true)
    void extensions.request<JourneyGraph>({ kind: 'profile', profile }, 'journey.graph').then(result => {
      if (!current) return
      if (!Array.isArray(result.nodes) || !Array.isArray(result.edges)) throw new Error('Invalid learning graph')
      setGraph(result)
    }).catch(cause => {
      if (current) setError(describeError(cause, language))
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [connected, profile, epoch, revision, extensions, language])

  const openNode = async (id: string, trigger: HTMLButtonElement) => {
    if (!profile || busy || detailLoading) return
    triggerRef.current = trigger
    const started = contextRef.current
    setDetailLoading(true)
    setError('')
    try {
      const detail = await extensions.request<JourneyDetail>({ kind: 'profile', profile }, 'journey.node', { id })
      if (contextRef.current !== started) return
      if (!detail.ok || detail.id !== id || typeof detail.content !== 'string') throw new Error('Invalid learning node')
      setSelected(detail)
      setDraft(detail.content)
    } catch (cause) {
      if (contextRef.current === started) setError(describeError(cause, language))
    } finally {
      if (contextRef.current === started) setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    if (!selected || busy) return
    if (draft !== selected.content && !window.confirm(zh ? '放弃尚未保存的修改？' : 'Discard unsaved changes?')) return
    setSelected(null)
    setDraft('')
    triggerRef.current?.focus()
  }

  React.useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDetail() }
      if (event.key !== 'Tab' || !detailRef.current) return
      const controls = [...detailRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')]
      if (controls.length === 0) return
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, draft, busy, zh])

  React.useEffect(() => { if (selected) editorRef.current?.focus() }, [selected?.id])

  const mutateNode = async (operation: 'journey.edit' | 'journey.delete') => {
    if (!profile || !selected || busy) return
    if (operation === 'journey.delete' && !window.confirm(zh ? `删除「${selected.label}」？Skill 会归档，记忆会移除。` : `Delete “${selected.label}”? Skills are archived; memories are removed.`)) return
    const started = contextRef.current
    setBusy(true)
    setError('')
    try {
      const result = await extensions.request<{ ok: boolean }>({ kind: 'profile', profile }, operation,
        operation === 'journey.edit' ? { id: selected.id, content: draft } : { id: selected.id })
      if (contextRef.current !== started) return
      if (!result.ok) throw new Error('Learning node update failed')
      setSelected(null)
      setDraft('')
      refresh()
    } catch (cause) {
      if (contextRef.current === started) setError(describeError(cause, language))
    } finally {
      if (contextRef.current === started) setBusy(false)
    }
  }

  const nodes = [...(graph?.nodes || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  const skillCount = nodes.filter(node => node.kind === 'skill').length
  const memoryCount = nodes.length - skillCount
  return <section className={`settings-panel flat-settings-panel journey-panel${embedded ? ' journey-embedded' : ''}`}>
    <div className="journey-content">
      <header className="journey-heading">
        <div>
          <h2>{zh ? '学习时间线' : 'Learning timeline'}</h2>
          <p>{zh ? '查看当前 Profile 积累的 Skill 与记忆。' : 'Skills and memories learned by this profile.'}</p>
        </div>
        <button type="button" className="journey-refresh" disabled={!connected || loading} onClick={refresh}>{zh ? '刷新记录' : 'Refresh'}</button>
      </header>
      {!connected && <p className="journey-state" role="status">{zh ? '请先启动运行时。' : 'Start the runtime first.'}</p>}
      {loading && <p className="journey-state" role="status">{zh ? '正在读取学习记录…' : 'Loading learning records…'}</p>}
      {error && !selected && <p className="journey-state journey-error" role="alert">{error}</p>}
      {!loading && graph && <>
        <div className="journey-summary">
          <strong>{zh ? `${skillCount} 个 Skill` : `${skillCount} skills`}</strong>
          <span aria-hidden="true">·</span>
          <span>{zh ? `${memoryCount} 条记忆` : `${memoryCount} memories`}</span>
        </div>
        {nodes.length === 0 ? <div className="journey-empty"><strong>{zh ? '暂无学习记录' : 'No learning records yet'}</strong><p>{zh ? '新的 Skill 和记忆会出现在这里。' : 'New skills and memories will appear here.'}</p></div> : <ol className="journey-timeline">
          {nodes.map(node => <li className="journey-entry" key={node.id}>
            <button type="button" className="journey-entry-button" aria-label={zh ? `查看${node.kind === 'skill' ? 'Skill' : '记忆'}：${node.label}` : `View ${node.kind}: ${node.label}`}
              disabled={busy || detailLoading} onClick={event => void openNode(node.id, event.currentTarget)}>
              <span className="journey-entry-top">
                <span className={`journey-kind journey-kind-${node.kind}`}>{node.kind === 'skill' ? 'Skill' : (zh ? '记忆' : 'Memory')}</span>
                {node.timestamp && <time dateTime={new Date(node.timestamp * 1000).toISOString()}>{new Date(node.timestamp * 1000).toLocaleDateString(language)}</time>}
              </span>
              <strong className="journey-entry-title">{node.label}</strong>
              <span className="journey-entry-bottom">
                {node.category && <span>{node.category}</span>}
                {node.kind === 'skill' && node.useCount > 0 && <span>{zh ? `使用 ${node.useCount} 次` : `Used ${node.useCount} times`}</span>}
              </span>
              <span className="journey-entry-arrow" aria-hidden="true">›</span>
            </button>
          </li>)}</ol>}
      </>}
      {detailLoading && <p className="journey-state" role="status">{zh ? '正在读取记录…' : 'Loading record…'}</p>}
    </div>
    {selected && <div className="journey-overlay">
      <button type="button" className="journey-backdrop" aria-label={zh ? '关闭记录详情' : 'Close record details'} disabled={busy} onClick={closeDetail} />
      <aside ref={detailRef} className="journey-detail" role="dialog" aria-modal="true" aria-labelledby="journey-detail-title">
        <header className="journey-detail-header">
          <div><span className={`journey-kind journey-kind-${selected.kind}`}>{selected.kind === 'skill' ? 'Skill' : (zh ? '记忆' : 'Memory')}</span><h3 id="journey-detail-title">{selected.label}</h3></div>
          <button type="button" className="journey-detail-close" aria-label={zh ? '关闭' : 'Close'} disabled={busy} onClick={closeDetail}>×</button>
        </header>
        <div className="journey-detail-body">
          {error && <p className="journey-error" role="alert">{error}</p>}
          <label htmlFor="journey-content">{zh ? '记录内容' : 'Record content'}</label>
          <textarea ref={editorRef} id="journey-content" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} rows={14} />
          <p>{zh ? '修改只会保存到当前 Profile。' : 'Changes are saved to this profile only.'}</p>
        </div>
        <footer className="journey-detail-actions">
          <button type="button" className="journey-delete" disabled={busy} onClick={() => void mutateNode('journey.delete')}>{zh ? '删除记录' : 'Delete record'}</button>
          <button type="button" className="journey-save" disabled={busy || !draft.trim() || draft === selected.content} onClick={() => void mutateNode('journey.edit')}>{zh ? '保存修改' : 'Save changes'}</button>
        </footer>
      </aside>
    </div>}
  </section>
}
