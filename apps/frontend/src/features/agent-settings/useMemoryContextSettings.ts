import React from 'react'
import type { AgentConfigField, AgentConfigSchema } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import {
  configFieldText,
  configValuesEqual,
  getNestedConfigValue,
  memoryFieldGroups,
  parseConfigFieldDraft,
  sensitiveMemoryFieldCount,
  unsupportedMemoryFieldCount,
  type MemorySettingsPage,
} from './memoryContextModel'

type Options = {
  connected: boolean
  profile: string | null
  page: MemorySettingsPage
  language: Language
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}

function draftErrorMessage(code: string, language: Language): string {
  const zh = language === 'zh-CN'
  if (code === 'invalid-number') return zh ? '请输入有效数字。' : 'Enter a valid number.'
  if (code === 'invalid-array') return zh ? '请输入有效的 JSON 数组。' : 'Enter a valid JSON array.'
  if (code === 'invalid-object') return zh ? '请输入有效的 JSON 对象。' : 'Enter a valid JSON object.'
  return zh ? '字段值无效。' : 'The field value is invalid.'
}

export function useMemoryContextSettings({ connected, profile, page, language, onDirtyChange, onBusyChange }: Options) {
  const { agentSettings } = useDesktop()
  const [schema, setSchema] = React.useState<AgentConfigSchema | null>(null)
  const [config, setConfig] = React.useState<Record<string, unknown>>({})
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const requestRef = React.useRef(0)

  const dirty = Object.entries(drafts).some(([key, value]) => value !== configFieldText(
    getNestedConfigValue(config, key), schema?.fields[key]?.type || 'string',
  ))

  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(saving) }, [saving, onBusyChange])
  React.useEffect(() => () => { onDirtyChange(false); onBusyChange(false) }, [onDirtyChange, onBusyChange])

  const load = React.useCallback(async (savedKey?: string) => {
    if (!connected || !profile) return false
    const request = ++requestRef.current
    const scope = { kind: 'profile' as const, profile }
    setLoading(true)
    if (!savedKey) setStatus('')
    try {
      const [nextSchema, nextConfig] = await Promise.all([
        agentSettings.schema(scope),
        agentSettings.config(scope),
      ])
      if (request !== requestRef.current) return false
      setSchema(nextSchema)
      setConfig(nextConfig)
      setLoaded(true)
      if (savedKey) {
        setDrafts(previous => { const next = { ...previous }; delete next[savedKey]; return next })
      } else {
        setDrafts({})
        setEditingKey(null)
      }
      return true
    } catch (cause) {
      if (request === requestRef.current) {
        setLoaded(false)
        setStatus(`${language === 'zh-CN' ? '读取失败' : 'Load failed'}：${describeError(cause, language)}`)
      }
      return false
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [agentSettings, connected, language, profile])

  React.useEffect(() => {
    ++requestRef.current
    setSchema(null)
    setConfig({})
    setDrafts({})
    setEditingKey(null)
    setLoaded(false)
    setStatus('')
    if (connected && profile) void load()
    return () => { ++requestRef.current }
  }, [connected, profile, page, load])

  function editField(key: string) {
    if (dirty && !window.confirm(language === 'zh-CN' ? '放弃尚未保存的设置？' : 'Discard unsaved settings?')) return
    setDrafts({})
    setEditingKey(key)
    setStatus('')
  }

  function cancelEdit() {
    setDrafts({})
    setEditingKey(null)
    setStatus('')
  }

  async function reload() {
    if (dirty && !window.confirm(language === 'zh-CN' ? '放弃尚未保存的设置？' : 'Discard unsaved settings?')) return
    await load()
  }

  async function saveField(key: string, field: AgentConfigField) {
    const text = drafts[key]
    if (text === undefined || !profile) return
    let expected: unknown
    try { expected = parseConfigFieldDraft(text, field) }
    catch (cause) {
      setStatus(`${key}：${draftErrorMessage(cause instanceof Error ? cause.message : '', language)}`)
      return
    }
    const request = ++requestRef.current
    const scope = { kind: 'profile' as const, profile }
    setSaving(true)
    setStatus('')
    try {
      await agentSettings.saveField(scope, key, expected)
      const [nextSchema, nextConfig] = await Promise.all([
        agentSettings.schema(scope),
        agentSettings.config(scope),
      ])
      if (request !== requestRef.current) return
      const actual = getNestedConfigValue(nextConfig, key)
      if (!configValuesEqual(actual, expected)) {
        throw new Error(language === 'zh-CN' ? '保存后回读值不一致。' : 'The saved value did not match the value read back.')
      }
      setSchema(nextSchema)
      setConfig(nextConfig)
      setDrafts(previous => { const next = { ...previous }; delete next[key]; return next })
      setEditingKey(null)
      setLoaded(true)
      setStatus(language === 'zh-CN' ? `${key} 已保存并回读确认。` : `${key} was saved and verified.`)
    } catch (cause) {
      if (request === requestRef.current) setStatus(`${language === 'zh-CN' ? '保存失败' : 'Save failed'}：${describeError(cause, language)}`)
    } finally {
      if (request === requestRef.current) setSaving(false)
    }
  }

  return {
    schema,
    config,
    drafts,
    setDrafts,
    editingKey,
    loading,
    saving,
    loaded,
    status,
    groups: memoryFieldGroups(schema, page),
    sensitiveCount: sensitiveMemoryFieldCount(schema, page),
    unsupportedCount: unsupportedMemoryFieldCount(schema, page),
    editField,
    cancelEdit,
    reload,
    saveField,
  }
}
