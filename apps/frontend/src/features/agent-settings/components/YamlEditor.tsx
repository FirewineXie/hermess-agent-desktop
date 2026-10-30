import { useEffect, useState, type KeyboardEvent } from 'react'
import { displayPath } from '../../../shared/displayPath'
import { checkYamlDraft, formatYamlDraft } from '../yamlDraft'

type Props = {
  path: string | undefined
  draft: string
  dirty: boolean
  busy: boolean
  zh: boolean
  t: (key: string, ...values: unknown[]) => string
  onChange: (value: string) => void
  onSave: () => void
}

export default function YamlEditor({ path, draft, dirty, busy, zh, t, onChange, onSave }: Props) {
  const [checked, setChecked] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  useEffect(() => { setConfirmSave(false) }, [path, draft])
  useEffect(() => { setChecked(false) }, [path])
  const result = checkYamlDraft(draft)
  const issue = result.valid ? '' : result.reason === 'root'
    ? (zh ? '根节点必须是映射（例如 plugins:）。' : 'The root must be a mapping (for example, plugins:).')
    : (zh ? `第 ${result.line} 行，第 ${result.column} 列附近有 YAML 格式错误。` : `YAML syntax error near line ${result.line}, column ${result.column}.`)

  function change(value: string) { setChecked(false); setConfirmSave(false); onChange(value) }

  function indent(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    if (start === end) {
      change(draft.slice(0, start) + '  ' + draft.slice(end))
      requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2 })
      return
    }
    const lineStart = draft.lastIndexOf('\n', start - 1) + 1
    const selected = draft.slice(lineStart, end)
    const indented = selected.replace(/^/gm, '  ')
    change(draft.slice(0, lineStart) + indented + draft.slice(end))
    requestAnimationFrame(() => { target.selectionStart = start + 2; target.selectionEnd = end + indented.length - selected.length })
  }

  function format() {
    setChecked(true)
    setConfirmSave(false)
    const formatted = formatYamlDraft(draft)
    if (formatted !== null && formatted !== draft) onChange(formatted)
  }

  return <>
    <p>{t('ui.file')}<code>{path ? displayPath(path) : t('ui.loading')}</code></p>
    <label htmlFor="agent-config-yaml">{t('ui.full.config.yaml')}</label>
    <textarea id="agent-config-yaml" className="config-yaml" value={draft} disabled={busy} onChange={event => change(event.target.value)} onKeyDown={indent} spellCheck={false} aria-invalid={checked && !result.valid} aria-describedby="config-yaml-help config-yaml-check" />
    <p id="config-yaml-help" className="config-yaml-help">{zh ? '按 Tab 插入两个空格。格式化会调整排版，请保存前检查差异；插件配置项以插件文档为准。' : 'Tab inserts two spaces. Formatting adjusts layout; review changes before saving. Follow each plugin’s documentation for its settings.'}</p>
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => setChecked(true)}>{zh ? '检查格式' : 'Check YAML'}</button>
      <button type="button" disabled={busy} onClick={format}>{zh ? '格式化' : 'Format'}</button>
      <button type="button" disabled={busy || !dirty} onClick={() => { setChecked(true); if (result.valid) setConfirmSave(true) }}>{t('ui.save.full.yaml')}</button>
    </div>
    <p id="config-yaml-check" role="status" className={checked && !result.valid ? 'config-yaml-error' : 'config-yaml-help'}>{checked ? (issue || (zh ? 'YAML 格式有效；保存时仍会由运行时校验配置内容。' : 'YAML syntax is valid. The runtime will still validate the configuration when saved.')) : ''}</p>
    {confirmSave && <div className="config-yaml-confirm" role="group" aria-label={zh ? '确认替换完整配置' : 'Confirm full configuration replacement'}>
      <p>{zh ? '将替换此 Profile 的完整配置。确认保存？' : 'Replace this Profile’s full configuration?'}</p>
      <button type="button" disabled={busy} onClick={() => { setConfirmSave(false); onSave() }}>{zh ? '确认保存' : 'Confirm save'}</button>
      <button type="button" disabled={busy} onClick={() => setConfirmSave(false)}>{t('ui.cancel')}</button>
    </div>}
  </>
}
