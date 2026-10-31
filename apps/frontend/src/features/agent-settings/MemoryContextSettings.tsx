import React from 'react'
import type { Language } from '../../i18n'
import ConfigFieldEditor from './components/ConfigFieldEditor'
import CompressionRoutePicker from './CompressionRoutePicker'
import MemoryProviderSettings from './MemoryProviderSettings'
import type { MemorySettingsPage } from './memoryContextModel'
import { useMemoryContextSettings } from './useMemoryContextSettings'

type Props = {
  connected: boolean
  profile: string | null
  storagePath: string
  page: MemorySettingsPage
  language: Language
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}

export default function MemoryContextSettings({ connected, profile, storagePath, page, language, onDirtyChange, onBusyChange }: Props) {
  const zh = language === 'zh-CN'
  const [fieldDirty, setFieldDirty] = React.useState(false)
  const [providerDirty, setProviderDirty] = React.useState(false)
  const [routeDirty, setRouteDirty] = React.useState(false)
  const [fieldBusy, setFieldBusy] = React.useState(false)
  const [providerBusy, setProviderBusy] = React.useState(false)
  const [routeBusy, setRouteBusy] = React.useState(false)
  React.useEffect(() => { onDirtyChange(fieldDirty || providerDirty || routeDirty) }, [fieldDirty, providerDirty, routeDirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(fieldBusy || providerBusy || routeBusy) }, [fieldBusy, providerBusy, routeBusy, onBusyChange])
  const controller = useMemoryContextSettings({ connected, profile, page, language, onDirtyChange: setFieldDirty, onBusyChange: setFieldBusy })
  const {
    schema, config, drafts, setDrafts, editingKey, loading, saving, loaded, status, groups, sensitiveCount, unsupportedCount,
    editField, cancelEdit, reload, saveField,
  } = controller
  const title = page === 'memory-persistent' ? (zh ? '持久记忆' : 'Persistent memory') : (zh ? '上下文与压缩' : 'Context & compression')
  const description = page === 'memory-persistent'
    ? (zh ? '配置当前 Profile 的长期记忆、用户画像和记忆提供方。' : 'Configure long-term memory, the user profile, and the memory provider for this Profile.')
    : (zh ? '配置当前 Profile 的上下文引擎、压缩策略和压缩模型。' : 'Configure the context engine, compression policy, and compression model for this Profile.')
  const t = (key: string) => ({
    'ui.edit': zh ? '编辑' : 'Edit',
    'ui.on': zh ? '开启' : 'On',
    'ui.off': zh ? '关闭' : 'Off',
    'ui.not.set': zh ? '未设置' : 'Not set',
    'ui.save.setting': zh ? '保存设置' : 'Save setting',
    'ui.cancel': zh ? '取消' : 'Cancel',
  })[key] || key

  return <section className="memory-context-settings">
    <div className="memory-settings-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
      <button type="button" disabled={loading || saving} onClick={() => void reload()}>{zh ? '重新读取' : 'Reload'}</button>
    </div>
    {!connected || !profile ? <div className="memory-settings-state" role="status">
      {zh ? '连接运行时并选择 Profile 后可编辑。' : 'Connect the runtime and select a Profile to edit these settings.'}
    </div> : loading && !loaded ? <div className="memory-settings-state" role="status">
      {zh ? '正在读取运行时配置…' : 'Loading runtime configuration…'}
    </div> : !loaded ? <div className="memory-settings-state memory-settings-error" role="alert">
      <p>{status || (zh ? '无法读取运行时配置。' : 'Runtime configuration could not be loaded.')}</p>
      <button type="button" disabled={loading} onClick={() => void reload()}>{zh ? '重试' : 'Retry'}</button>
    </div> : <>
      {groups.map(group => group.fields.length > 0 && <section className="memory-settings-group" key={group.id}>
        <div className="memory-settings-group-copy"><h3>{zh ? group.zh : group.en}</h3><p>{zh ? group.descriptionZh : group.descriptionEn}</p></div>
        <div className="memory-settings-fields">
          {group.id === 'compression-model' && profile && schema?.fields['auxiliary.compression.provider'] && schema.fields['auxiliary.compression.model'] && <CompressionRoutePicker
            profile={profile} storagePath={storagePath} config={config} schema={schema} language={language} disabled={fieldDirty || saving}
            onSaved={reload} onDirtyChange={setRouteDirty} onBusyChange={setRouteBusy} />}
          {group.fields.filter(([key]) => group.id !== 'compression-model' || !schema?.fields['auxiliary.compression.model']
            || !['auxiliary.compression.provider', 'auxiliary.compression.model', 'auxiliary.compression.base_url', 'auxiliary.compression.reasoning_effort', 'auxiliary.compression.timeout'].includes(key)).map(entry => <ConfigFieldEditor key={entry[0]} entry={entry} config={config} draft={drafts[entry[0]]}
            editing={editingKey === entry[0]} busy={saving} language={language} t={t}
            onEdit={editField} onChange={(key, value) => setDrafts({ [key]: value })}
            onSave={([key, field]) => void saveField(key, field)} onCancel={cancelEdit} />)}
        </div>
      </section>)}
      {groups.every(group => group.fields.length === 0) && <div className="memory-settings-state" role="status">
        {zh ? '当前运行时 Schema 没有提供此页面可配置的字段。' : 'The runtime schema does not provide configurable fields for this page.'}
      </div>}
      {page === 'memory-persistent' && <MemoryProviderSettings profile={profile} language={language} onDirtyChange={setProviderDirty} onBusyChange={setProviderBusy} />}
      {sensitiveCount > 0 && <p className="memory-settings-sensitive-note" role="note">
        {zh ? `已隐藏 ${sensitiveCount} 个敏感凭据字段；普通配置页不会读取或覆盖密钥。` : `${sensitiveCount} sensitive credential field(s) are hidden; this settings page does not read or overwrite secrets.`}
      </p>}
      {unsupportedCount > 0 && <p className="memory-settings-sensitive-note" role="note">
        {zh ? `当前运行时还返回了 ${unsupportedCount} 个客户端无法安全编辑的字段类型，已保持原值。` : `${unsupportedCount} field(s) use unsupported runtime types and have been left unchanged.`}
      </p>}
    </>}
    {status && loaded && <p className="memory-settings-status" role="status">{status}</p>}
  </section>
}
