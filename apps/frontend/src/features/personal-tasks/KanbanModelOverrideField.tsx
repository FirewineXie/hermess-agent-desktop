import React from 'react'
import type { KanbanModelOptions } from './kanbanApi'
import type { TaskModelOverride } from './kanbanTaskModel'

const EFFORTS = [
  ['', '继承 Profile'], ['none', '关闭思考'], ['minimal', 'Minimal'], ['low', 'Low'],
  ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'XHigh'], ['max', 'Max'], ['ultra', 'Ultra'],
] as const

export default function KanbanModelOverrideField({ value, options, disabled = false, onChange }: {
  value: TaskModelOverride
  options: KanbanModelOptions
  disabled?: boolean
  onChange(next: TaskModelOverride): void
}) {
  const provider = options.providers.find(item => item.slug === value.provider)
  const models = provider?.models || []
  const listId = React.useId()
  return <div className="kanban-native-model-fields">
    <label>模型提供方<select value={value.provider} disabled={disabled} onChange={event => onChange({ ...value, provider: event.target.value, model: '' })}>
      <option value="">自动 / 不指定</option>
      {options.providers.map(item => <option key={item.slug} value={item.slug}>{item.label || item.slug}</option>)}
      {value.provider && !options.providers.some(item => item.slug === value.provider) && <option value={value.provider}>{value.provider}</option>}
    </select></label>
    <label>执行模型<input list={listId} value={value.model} disabled={disabled} onChange={event => onChange({ ...value, model: event.target.value })} placeholder="留空则继承 Profile" />
      <datalist id={listId}>{models.map(model => <option key={model} value={model} />)}</datalist>
    </label>
    <label>推理强度<select value={value.effort} disabled={disabled} onChange={event => onChange({ ...value, effort: event.target.value })}>
      {EFFORTS.map(([id, label]) => <option key={id || 'inherit'} value={id}>{label}</option>)}
    </select></label>
  </div>
}
