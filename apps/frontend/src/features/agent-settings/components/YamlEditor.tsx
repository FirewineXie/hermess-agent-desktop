import { displayPath } from '../../../shared/displayPath'

type Props = {
  path: string | undefined
  draft: string
  dirty: boolean
  busy: boolean
  t: (key: string, ...values: unknown[]) => string
  onChange: (value: string) => void
  onSave: () => void
}

export default function YamlEditor({ path, draft, dirty, busy, t, onChange, onSave }: Props) {
  return <>
    <p>{t('ui.file')}<code>{path ? displayPath(path) : t('ui.loading')}</code></p>
    <label htmlFor="agent-config-yaml">{t('ui.full.config.yaml')}</label>
    <textarea id="agent-config-yaml" className="config-yaml" value={draft} disabled={busy} onChange={event => onChange(event.target.value)} spellCheck={false} />
    <div className="actions"><button disabled={busy || !dirty} onClick={onSave}>{t('ui.save.full.yaml')}</button></div>
  </>
}
