import type { AgentConfigField, AgentConfigSchema } from '@hermess/contracts'
import type { SettingsPage } from '../settings/model'
import { isSensitiveConfigField, isSupportedConfigField, parseConfigFieldDraft } from '../agent-settings/memoryContextModel.ts'

export type ConfigurationPage = 'session-auto-archive' | 'security-approvals' | 'security-privacy' | 'security-checkpoints' | 'advanced-runtime' | 'advanced-tools' | 'advanced-terminal' | 'advanced-output' | 'advanced-config' | 'browser'
export const configurationPages: ConfigurationPage[] = ['session-auto-archive','security-approvals','security-privacy','security-checkpoints','advanced-runtime','advanced-tools','advanced-terminal','advanced-output','advanced-config','browser']
export const isConfigurationPage = (page: SettingsPage): page is ConfigurationPage => configurationPages.includes(page as ConfigurationPage)

export function fieldOwner(key: string): SettingsPage {
  if (['sessions.auto_archive', 'sessions.auto_archive_days'].includes(key)) return 'session-auto-archive'
  if (key === 'browser.use_real_profile') return 'browser'
  if (key === 'command_allowlist' || key.startsWith('approvals.') || key.startsWith('security.approval.')) return 'security-approvals'
  if (key.startsWith('security.')) return 'security-privacy'
  if (key.startsWith('checkpoints.')) return 'security-checkpoints'
  if (key.startsWith('delegation.')) return 'delegation'
  if (key.startsWith('moa.')) return 'moa'
  if (key.startsWith('memory.')) return 'memory-persistent'
  if (key.startsWith('context.') || key.startsWith('compression.') || key.startsWith('auxiliary.compression.')) return 'memory-context'
  if (key.startsWith('auxiliary.')) return 'auxiliary'
  if (key === 'fallback_providers') return 'fallbacks'
  if (key === 'model_context_length' || key.startsWith('model.') || ['agent.reasoning_effort','agent.service_tier'].includes(key)) return 'main'
  if (key.startsWith('terminal.')) return 'advanced-terminal'
  if (key.startsWith('tool_output.')) return 'advanced-output'
  if (key === 'toolsets' || key.startsWith('toolsets.') || key === 'agent.tool_use_enforcement' || key.startsWith('tools.')) return 'advanced-tools'
  if (key.startsWith('agent.')) return 'advanced-runtime'
  return 'advanced-config'
}

export function editableField(key: string, field: AgentConfigField): boolean {
  return !isSensitiveConfigField(key) && isSupportedConfigField(field)
}

export function visibleSchemaFields(schema: AgentConfigSchema | null): Array<[string, AgentConfigField]> {
  return Object.entries(schema?.fields || {}).filter(([key]) => key !== 'telemetry.shared_metrics' && !key.startsWith('telemetry.shared_metrics.'))
}

export function pageFields(schema: AgentConfigSchema | null, page: ConfigurationPage): Array<[string, AgentConfigField]> {
  return visibleSchemaFields(schema).filter(([key,field]) => fieldOwner(key) === page && editableField(key,field))
}

export function parseField(text: string, field: AgentConfigField): unknown {
  if (field.type === 'boolean' && !['true','false'].includes(text)) throw new Error('布尔值必须是 true 或 false。')
  if (field.type === 'select' && field.options) {
    const option=field.options.find(value=>String(value)===text)
    if(option===undefined)throw new Error('请选择运行时提供的有效选项。')
    return option
  }
  return parseConfigFieldDraft(text, field)
}

export function allowlistFromText(text: string): string[] {
  const rows = JSON.parse(text || '[]') as unknown
  if (!Array.isArray(rows) || rows.some(value => typeof value !== 'string')) throw new Error('当前允许列表不是字符串数组，请使用完整 YAML 检查。')
  return rows
}
