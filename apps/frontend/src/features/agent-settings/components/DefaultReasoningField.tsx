import type { Language } from '../../../i18n'
import { fieldText, getField, type Field } from '../model'

const KEY = 'agent.reasoning_effort'
const LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

type Props = {
  field: Field
  config: Record<string, unknown>
  draft?: string
  busy: boolean
  language: Language
  onChange: (value: string) => void
  onSave: () => void
}

export default function DefaultReasoningField({ field, config, draft, busy, language, onChange, onSave }: Props) {
  const current = getField(config, KEY)
  const currentText = fieldText(current, field.type)
  const selected = draft ?? (current === false ? 'none' : typeof current === 'string' ? current : '')
  const changed = draft !== undefined && draft !== currentText
  const zh = language === 'zh-CN'

  return <div className="default-reasoning-field">
    <h3>{zh ? '新会话默认思考强度' : 'Default reasoning for new chats'}</h3>
    <p>{zh ? '保存到当前 Hermes 实例的 agent.reasoning_effort。新会话自动采用；已有会话可在聊天栏单独调整。' : 'Saved as agent.reasoning_effort in this Hermes instance. New chats use it automatically; existing chats can choose their own level.'}</p>
    <label htmlFor="default-reasoning-effort">{zh ? '默认档位' : 'Default level'}
      <select id="default-reasoning-effort" value={selected} disabled={busy} onChange={event => onChange(event.target.value)}>
        <option value="" disabled={current !== null && typeof current === 'object'}>{current !== null && typeof current === 'object' ? (zh ? 'YAML 自定义档位' : 'Custom YAML level') : (zh ? '未设置（由 Hermes 决定）' : 'Unset (Hermes decides)')}</option>
        {LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
      </select>
    </label>
    <small>{zh ? '若配置了按模型覆盖值，匹配模型时会优先使用该值。' : 'A matching per-model override takes precedence over this default.'}</small>
    <button type="button" disabled={busy || !changed} onClick={onSave}>{zh ? '保存默认档位' : 'Save default level'}</button>
  </div>
}
