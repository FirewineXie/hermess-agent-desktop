import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'

type Snapshot = {
  current: string
  options: Array<{ name: string; description: string }>
}

type Props = {
  profile: string
  language: Language
  onDirtyChange(dirty: boolean): void
  onBusyChange(busy: boolean): void
}

export default function ContextEngineSettings({ profile, language, onDirtyChange, onBusyChange }: Props) {
  const { extensions } = useDesktop()
  const zh = language === 'zh-CN'
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [draft, setDraft] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const generation = React.useRef(0)
  const dirty = Boolean(snapshot && draft !== snapshot.current)
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(loading || saving) }, [loading, saving, onBusyChange])

  const load = React.useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setStatus('')
    try {
      const next = await extensions.request<Snapshot>({ kind: 'profile', profile }, 'hermesPlugins.contextEngines')
      if (current !== generation.current) return
      setSnapshot(next)
      setDraft(next.current)
    } catch (error) {
      if (current === generation.current) { setSnapshot(null); setStatus(describeError(error, language)) }
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [extensions, profile, language])

  React.useEffect(() => {
    setSnapshot(null); setDraft(''); setStatus('')
    void load()
    return () => { generation.current += 1; onDirtyChange(false); onBusyChange(false) }
  }, [load, onDirtyChange, onBusyChange])

  const save = async () => {
    if (!snapshot || !dirty || saving) return
    const current = generation.current
    setSaving(true)
    setStatus('')
    try {
      const next = await extensions.request<Snapshot>(
        { kind: 'profile', profile }, 'hermesPlugins.contextEngine.save', { name: draft })
      if (current !== generation.current) return
      setSnapshot(next)
      setDraft(next.current)
      setStatus(zh ? '上下文引擎已保存并回读确认。' : 'Context engine saved and verified.')
    } catch (error) {
      if (current === generation.current) setStatus(describeError(error, language))
    } finally {
      if (current === generation.current) setSaving(false)
    }
  }

  return <div className="memory-provider-editor">
    <label>{zh ? '已发现的上下文引擎' : 'Discovered context engine'}
      <select value={draft} disabled={loading || saving || !snapshot} onChange={event => setDraft(event.target.value)}>
        {(snapshot?.options || []).map(option => <option key={option.name} value={option.name}>{option.name}</option>)}
      </select>
    </label>
    {snapshot?.options.find(option => option.name === draft)?.description && <p>{snapshot.options.find(option => option.name === draft)?.description}</p>}
    <div className="actions">
      <button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存上下文引擎' : 'Save context engine')}</button>
      <button type="button" disabled={loading || saving} onClick={() => void load()}>{zh ? '重新发现' : 'Rediscover'}</button>
    </div>
    {status && <p role={snapshot ? 'status' : 'alert'}>{status}</p>}
  </div>
}
