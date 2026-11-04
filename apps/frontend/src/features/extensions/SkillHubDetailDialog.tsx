import React from 'react'
import { useLanguage } from '../../i18n'
import type { HubPreview, HubScan, HubSkill } from './model'
import { keepFocusInside } from './dialogFocus'

type Props = {
  item: HubSkill
  busy: boolean
  request: <R>(operation: string, payload?: Record<string, unknown>) => Promise<R>
  onClose(): void
  onInstall(): void
}

function errorText(error: unknown, zh: boolean) {
  if (error instanceof Error && error.message) return error.message
  return zh ? '请求失败，请稍后重试。' : 'The request failed. Try again.'
}

export default function SkillHubDetailDialog({ item, busy, request, onClose, onInstall }: Props) {
  const zh = useLanguage() === 'zh-CN'
  const [preview, setPreview] = React.useState<HubPreview | null>(null)
  const [scan, setScan] = React.useState<HubScan | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [scanning, setScanning] = React.useState(false)
  const [error, setError] = React.useState('')
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const requestRef = React.useRef(request)
  requestRef.current = request

  React.useEffect(() => {
    let active = true
    const previous = document.body.style.overflow
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    void requestRef.current<HubPreview>('skills.preview', { identifier: item.identifier })
      .then(value => { if (active) setPreview(value) })
      .catch(cause => { if (active) setError(errorText(cause, zh)) })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      document.body.style.overflow = previous
      opener?.focus()
    }
  }, [item.identifier, zh])

  const runScan = async () => {
    if (scanning) return
    setScanning(true)
    setError('')
    try { setScan(await request<HubScan>('skills.scan', { identifier: item.identifier })) }
    catch (cause) { setError(errorText(cause, zh)) }
    finally { setScanning(false) }
  }

  return <div className="expert-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy && !scanning) onClose() }}>
    <section className="skill-hub-detail" role="dialog" aria-modal="true" aria-labelledby="skill-hub-detail-title"
      onKeyDown={event => { if (event.key === 'Escape' && !busy && !scanning) onClose(); else keepFocusInside(event) }}>
      <header><div><h2 id="skill-hub-detail-title">{item.name}</h2><p>{item.identifier}</p></div><button ref={closeRef} type="button" aria-label={zh ? '关闭' : 'Close'} disabled={busy || scanning} onClick={onClose}>×</button></header>
      <div className="skill-hub-detail-body">
        <p>{preview?.description || item.description}</p>
        <div className="skill-hub-detail-meta"><span>{preview?.source || item.source}</span><span>{preview?.trust_level || item.trust_level || (zh ? '信任级别未知' : 'Unknown trust')}</span></div>
        {error && <p className="extension-message" role="alert">{error}</p>}
        {loading ? <p>{zh ? '正在读取 SKILL.md…' : 'Loading SKILL.md…'}</p> : preview ? <>
          {!!preview.files?.length && <details><summary>{zh ? `包含文件（${preview.files.length}）` : `Files (${preview.files.length})`}</summary><ul>{preview.files.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>}
          <pre className="skill-hub-source">{preview.skill_md?.trim() || (zh ? 'SKILL.md 为空。' : 'SKILL.md is empty.')}</pre>
        </> : <p>{zh ? '无法读取 Skill 内容。' : 'The Skill content could not be loaded.'}</p>}
        {scan && <section className={`skill-hub-scan policy-${scan.policy}`} aria-label={zh ? '安全扫描结果' : 'Security scan result'}>
          <h3>{zh ? '安全扫描' : 'Security scan'} · {scan.verdict || scan.policy}</h3>
          {scan.summary && <p>{scan.summary}</p>}
          {scan.policy_reason && <p>{scan.policy_reason}</p>}
          {!!scan.findings?.length && <ul>{scan.findings.map((finding, index) => <li key={`${finding.file}:${finding.line || 0}:${index}`}><strong>{finding.severity} · {finding.category}</strong><code>{finding.file}{finding.line ? `:${finding.line}` : ''}</code><span>{finding.description}</span></li>)}</ul>}
          {!scan.findings?.length && <p>{zh ? '没有返回具体发现项。' : 'No individual findings were returned.'}</p>}
        </section>}
      </div>
      <footer><button type="button" disabled={busy || scanning} onClick={() => void runScan()}>{scanning ? (zh ? '扫描中…' : 'Scanning…') : scan ? (zh ? '重新扫描' : 'Scan again') : (zh ? '安全扫描' : 'Security scan')}</button><button type="button" disabled={busy || loading} onClick={onInstall}>{zh ? '选择 Profile 安装' : 'Choose Profiles to install'}</button></footer>
    </section>
  </div>
}
