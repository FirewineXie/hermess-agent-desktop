import React from 'react'
import type { CodingProvider } from '@hermess/contracts'
import type { Language } from '../../i18n'

export default function ProgrammingProviderCard({ provider, defaultModel, language, busy, onModels, onEdit, onRemove }: {
  provider: CodingProvider; defaultModel: string; language: Language; busy: boolean
  onModels: () => void; onEdit: () => void; onRemove: () => void
}) {
  const zh = language === 'zh-CN'
  return <article className="programming-provider-card">
    <header className="programming-provider-heading"><h3 title={provider.name}>{provider.name}</h3><span>{provider.models.length} {zh ? '个模型' : 'models'}</span></header>
    <p className="programming-provider-endpoint" title={provider.base_url}>{provider.base_url}</p>
    <div className="programming-provider-models" aria-label={zh ? '已配置模型' : 'Configured models'}>
      {provider.models.slice(0, 2).map(model => <span className={model.id === defaultModel ? 'is-default' : ''} key={model.id} title={model.name}>{model.name}</span>)}
      {provider.models.length > 2 && <button type="button" disabled={busy} onClick={onModels}>{zh ? `另有 ${provider.models.length - 2} 个模型` : `${provider.models.length - 2} more`}</button>}
    </div>
    <footer className="programming-provider-footer"><button type="button" disabled={busy} onClick={onModels}>{zh ? '编辑模型' : 'Edit models'}</button><button type="button" disabled={busy} onClick={onEdit}>{zh ? '编辑配置' : 'Edit configuration'}</button><button type="button" className="programming-provider-remove" disabled={busy} onClick={onRemove}>{zh ? '删除' : 'Remove'}</button></footer>
  </article>
}
