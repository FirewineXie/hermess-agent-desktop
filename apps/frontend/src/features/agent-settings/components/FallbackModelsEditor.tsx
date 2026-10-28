import React from 'react'
import type { Provider } from '../model'

type Entry = Record<string, unknown> & { provider: string; model: string }

function normalize(value: unknown): Entry[] {
  if (!Array.isArray(value)) return []
  return value.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const row = item as Record<string, unknown>
      return { ...row, provider: String(row.provider ?? ''), model: String(row.model ?? '') }
    }
    if (typeof item === 'string') {
      const slash = item.indexOf('/')
      return slash > 0 ? { provider: item.slice(0, slash), model: item.slice(slash + 1) } : { provider: '', model: item }
    }
    return { provider: '', model: '' }
  })
}

export default function FallbackModelsEditor({ value, providers, busy, onChange, onSave, language }: {
  value: unknown
  providers: Provider[]
  busy: boolean
  onChange: (value: Entry[]) => void
  onSave: () => void
  language: 'zh-CN' | 'en-US'
}) {
  const [rows, setRows] = React.useState<Entry[]>(() => normalize(value))
  const [dirty, setDirty] = React.useState(false)
  const incomplete = rows.some(row => !row.provider.trim() || !row.model.trim())
  React.useEffect(() => { if (!dirty) setRows(normalize(value)) }, [value, dirty])
  const change = (next: Entry[]) => {
    setRows(next)
    setDirty(true)
    onChange(next)
  }
  return <section className="fallback-editor">
    <h2>{language === 'zh-CN' ? '回退模型顺序' : 'Fallback order'}</h2>
    <p>{language === 'zh-CN' ? '主模型失败时按此顺序尝试。修改提供商或模型时保留该行手写的其他路由参数；每行填完整后才能保存。' : 'Tried in this order after the main model fails. Other routing fields on each row are preserved. Complete every row before saving.'}</p>
    {rows.length === 0 && <p>{language === 'zh-CN' ? '尚无回退模型。' : 'No fallback models.'}</p>}
    {rows.map((row, index) => {
      const models = providers.find(item => item.slug === row.provider)?.models || []
      return <div className="fallback-row" key={index}>
        <span>{index + 1}</span>
        <select aria-label={`${index + 1} ${language === 'zh-CN' ? '提供商' : 'Provider'}`} value={row.provider} onChange={event => change(rows.map((item, i) => i === index ? { ...item, provider: event.target.value, model: '' } : item))}>
          <option value="">{language === 'zh-CN' ? '选择提供商' : 'Select provider'}</option>
          {row.provider && !providers.some(item => item.slug === row.provider) && <option value={row.provider}>{row.provider}</option>}
          {providers.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
        </select>
        <input aria-label={`${index + 1} ${language === 'zh-CN' ? '模型' : 'Model'}`} list={`fallback-models-${index}`} value={row.model} onChange={event => change(rows.map((item, i) => i === index ? { ...item, model: event.target.value } : item))} placeholder={language === 'zh-CN' ? '模型 ID' : 'Model ID'} />
        <datalist id={`fallback-models-${index}`}>{models.map(model => <option key={model} value={model} />)}</datalist>
        <button type="button" disabled={busy || index === 0} onClick={() => { const next = [...rows]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(next) }} aria-label={`${index + 1} ${language === 'zh-CN' ? '上移' : 'Move up'}`}>↑</button>
        <button type="button" disabled={busy || index === rows.length - 1} onClick={() => { const next = [...rows]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; change(next) }} aria-label={`${index + 1} ${language === 'zh-CN' ? '下移' : 'Move down'}`}>↓</button>
        <button type="button" disabled={busy} onClick={() => change(rows.filter((_, i) => i !== index))} aria-label={`${index + 1} ${language === 'zh-CN' ? '移除' : 'Remove'}`}>×</button>
      </div>
    })}
    <div className="actions"><button type="button" disabled={busy} onClick={() => change([...rows, { provider: '', model: '' }])}>{language === 'zh-CN' ? '添加回退模型' : 'Add fallback'}</button><button type="button" disabled={busy || !dirty || incomplete} onClick={onSave}>{language === 'zh-CN' ? '保存回退链' : 'Save fallback chain'}</button></div>
  </section>
}
