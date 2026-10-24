import { agentFieldTranslation, agentOptionTranslation, type Language } from '../../../i18n'
import { fieldText, getField, leafLabel, type FieldEntry } from '../model'

type Props = {
  entry: FieldEntry
  config: Record<string, unknown>
  draft?: string
  editing: boolean
  busy: boolean
  language: Language
  t: (key: string, ...values: unknown[]) => string
  onEdit: (key: string) => void
  onChange: (key: string, value: string) => void
  onSave: (entry: FieldEntry) => void
  onCancel: () => void
}

export default function ConfigFieldEditor({ entry: [key, field], config, draft, editing, busy, language, t, onEdit, onChange, onSave, onCancel }: Props) {
  const current = fieldText(getField(config, key), field.type)
  const value = draft ?? current
  const changed = draft !== undefined && value !== current
  const localized = agentFieldTranslation(language, key)
  const label = leafLabel(language, key)
  const secret = /(?:api_key|secret|token|password)$/i.test(key)
  const preview = secret && current ? '••••••' : current ? field.type === 'boolean' ? t(current === 'true' ? 'ui.on' : 'ui.off') : current.replace(/\s+/g, ' ') : t('ui.not.set')
  return <div className={`config-field${editing ? ' editing' : ''}`}>
    {!editing ? <button type="button" className="config-field-preview" onClick={() => onEdit(key)}>
      <span className="config-field-name">{label}</span>
      <span className="config-field-value" title={preview}>{preview}</span>
      <span className="config-field-edit">{t('ui.edit')}</span>
    </button> : <>
      <label htmlFor={`config-${key}`}>{label}</label>
      <code className="config-field-key">{key}</code>
      {(localized?.description || (!localized && field.description)) && <small>{localized?.description || field.description}</small>}
      {field.type === 'boolean'
        ? <select id={`config-${key}`} value={value} onChange={event => onChange(key, event.target.value)}><option value="true">{t('ui.on')}</option><option value="false">{t('ui.off')}</option></select>
        : field.type === 'select'
          ? <select id={`config-${key}`} value={value} onChange={event => onChange(key, event.target.value)}>
            {!field.options?.some(option => String(option) === value) && <option value={value}>{value || t('ui.not.set')}</option>}
            {field.options?.map(option => <option key={String(option)} value={String(option)}>{agentOptionTranslation(language, String(option))}</option>)}
          </select>
          : field.type === 'list' || field.type === 'object'
            ? <textarea id={`config-${key}`} value={value} rows={Math.min(12, Math.max(3, value.split('\n').length))} onChange={event => onChange(key, event.target.value)} spellCheck={false} />
            : <input id={`config-${key}`} type={secret ? 'password' : field.type === 'number' ? 'number' : 'text'} value={value} onChange={event => onChange(key, event.target.value)} />}
      <div className="config-field-actions">
        <button disabled={busy || !changed} onClick={() => onSave([key, field])}>{t('ui.save.setting')}</button>
        <button type="button" className="config-field-cancel" disabled={busy} onClick={onCancel}>{t('ui.cancel')}</button>
      </div>
    </>}
  </div>
}
