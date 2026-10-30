import type { CommandCatalog, ChatUsage } from '@hermess/contracts'
export type { PendingAttachment, CommandCatalog, CommandResult, ResumeResult, ChatUsage } from '@hermess/contracts'
import commandDescriptionsZh from '../../locales/app/command-descriptions.zh-CN.json'
import { translateApp } from '../../i18n'
import { argumentTrigger, argumentOptions } from './commandArguments'

export type ComposerChoice = { name: string; description: string; skill: boolean; available: boolean; availability: string; insertion?: string }
export const DESKTOP_GATEWAY_COMMANDS = new Set([
  'help', 'status', 'context', 'version', 'whoami', 'usage', 'insights', 'profile', 'diff',
  'memory', 'kanban', 'topup', 'suggestions', 'bundles', 'skills', 'title', 'goal', 'subgoal',
  'loop', 'heartbeat', 'review', 'refine', 'curator', 'login', 'autoprune',
  'plan', 'learn', 'init', 'moa', 'blueprint', 'egress', 'reasoning', 'approvals',
  'codex-runtime', 'fast', 'personality',
  'approve', 'deny', 'new', 'sessions', 'model', 'history', 'resume', 'retry', 'compress', 'agents', 'stop', 'config', 'tools', 'toolsets', 'cron', 'plugins', 'save',
])

export function commandSupported(catalog: CommandCatalog, name: string): boolean {
  if (Object.hasOwn(catalog.skills, name) || DESKTOP_GATEWAY_COMMANDS.has(name.slice(1))) return true
  if (catalog.categories?.some(category => category.name === 'Plugin commands' && category.pairs.some(([key]) => key === name))) return true
  return false
}

export function commandAvailability(catalog: CommandCatalog, name: string, language: 'zh-CN' | 'en-US'): string {
  if (commandSupported(catalog, name)) return translateApp(language, "ui.available")
  const desktop = catalog.commands[name]?.desktop
  if (desktop === 'terminal') return translateApp(language, "ui.terminal.only")
  if (desktop === 'settings') return translateApp(language, "ui.use.the.settings.page")
  return translateApp(language, "ui.not.available.in.the.desktop.app")
}

export function composerTrigger(draft: string, caret: number) {
  const position = Math.min(Math.max(caret, 0), draft.length)
  const argument = argumentTrigger(draft, position)
  if (argument) return argument
  const match = /(^|\s)([\/@])([^\s]*)$/.exec(draft.slice(0, position))
  if (!match) return null
  const start = position - match[2].length - match[3].length
  if (match[2] === '/' && start !== 0) return null
  return { prefix: match[2], query: match[3], start, end: position }
}

export function commandChoices(catalog: CommandCatalog, trigger: NonNullable<ReturnType<typeof composerTrigger>>, language: 'zh-CN' | 'en-US'): ComposerChoice[] {
  const { prefix, query } = trigger
  if ('command' in trigger) {
    if (!commandSupported(catalog, trigger.command)) return []
    return argumentOptions(catalog, trigger.command).filter(option => option.startsWith(query) && option !== query).map(option => ({
      name: option, insertion: option, description: trigger.command, skill: false, available: true,
      availability: translateApp(language, 'ui.available'),
    }))
  }
  return catalog.pairs.flatMap(([name, description]) => {
    const skill = Object.hasOwn(catalog.skills, name)
    if (prefix === '@' && !skill) return []
    if (prefix === '/' && skill) return []
    if (!name.slice(1).toLowerCase().includes(query.toLowerCase()) || !commandSupported(catalog, name)) return []
    const localized = language === 'zh-CN' ? commandDescriptionsZh[name as keyof typeof commandDescriptionsZh] : undefined
    const localDescriptions: Record<string, [string, string]> = {
      '/history': ['打开当前专家的会话历史', 'Open session history for this Profile'],
      '/resume': ['恢复会话：/resume 会话ID或完整名称；无参数打开历史', 'Resume: /resume ID or full title; no argument opens history'],
      '/stop': ['停止当前会话任务', 'Stop the current session task'],
      '/config': ['打开当前专家的完整配置页面', 'Open configuration for this Profile'],
      '/tools': ['打开客户端工具页面', 'Open desktop tools'],
      '/toolsets': ['查看当前专家的工具集配置', 'View toolset configuration for this Profile'],
      '/cron': ['打开定时任务页面', 'Open scheduled tasks'],
      '/plugins': ['打开扩展中心', 'Open Extension Hub'],
      '/save': ['导出当前会话：/save json|md|html [文件名] [redact]', 'Export current session: /save json|md|html [filename] [redact]'],
      '/retry': ['重新运行上一条用户请求', 'Retry the last user request'],
      '/compress': ['压缩当前会话：/compress [here N | focus 主题] [--preview]', 'Compress current session: /compress [here N | focus topic] [--preview]'],
      '/agents': ['查看当前会话的子代理与失败任务', 'View subagents and failed tasks for this session'],
    }
    const localDescription = localDescriptions[name]?.[language === 'zh-CN' ? 0 : 1]
    const modelDescription = name === '/model'
      ? translateApp(language, "ui.open.model.settings.saved.defaults.apply.to.new.sessions")
      : undefined
    return [{
      name: prefix === '@' ? `@${name.slice(1)}` : name,
      description: localDescription || modelDescription || localized || description,
      skill,
      available: commandSupported(catalog, name),
      availability: commandAvailability(catalog, name, language),
    }]
  })
}
export function contextPercent(usage: ChatUsage | null): number | null {
  if (!usage) return null
  const used = usage.context_used ?? usage.context_tokens ?? usage.last_prompt_tokens
  const maximum = usage.context_max ?? usage.context_length
  if (used == null || !Number.isFinite(used) || used <= 0 || !maximum || !Number.isFinite(maximum) || maximum <= 0) return null
  return Math.max(0, Math.min(100, Math.round(used / maximum * 100)))
}

export function contextLabel(usage: ChatUsage | null, language: 'zh-CN' | 'en-US'): string {
  const percent = contextPercent(usage)
  const estimated = usage?.context_estimated || (usage?.context_source && usage.context_source !== 'provider_usage')
  const used = usage?.context_used ?? usage?.context_tokens ?? usage?.last_prompt_tokens
  const maximum = usage?.context_max ?? usage?.context_length
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US'
  const usedText = used != null && Number.isFinite(used) && used > 0 ? used.toLocaleString(locale) : '—'
  const windowText = maximum != null && Number.isFinite(maximum) && maximum > 0 ? maximum.toLocaleString(locale) : '—'
  return language === 'zh-CN'
    ? `已用 ${usedText} / 窗口 ${windowText} Token${percent === null ? '' : ` · ${estimated ? '≈' : ''}${percent}%`}`
    : `Used ${usedText} / window ${windowText} tokens${percent === null ? '' : ` · ${estimated ? '≈' : ''}${percent}%`}`
}

export function contextDetails(usage: ChatUsage | null, language: 'zh-CN' | 'en-US'): string {
  if (!usage) return language === 'zh-CN' ? '当前会话的上下文数据尚未返回' : 'Context data has not returned for this session yet'
  const used = usage.context_used ?? usage.context_tokens ?? usage.last_prompt_tokens
  const maximum = usage.context_max ?? usage.context_length
  if (maximum == null || !Number.isFinite(maximum) || maximum <= 0) return language === 'zh-CN' ? '当前会话的上下文窗口尚未返回' : 'The context window has not returned for this session yet'
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US'
  const source = usage.config_context_length != null && usage.config_context_length > 0 && usage.config_context_length === maximum
    ? language === 'zh-CN' ? '手动配置' : 'Manual configuration'
    : language === 'zh-CN' ? 'Hermes 会话统计；具体解析来源未返回' : 'Hermes session stats; exact resolution source unavailable'
  return language === 'zh-CN'
    ? `已用 ${used != null && used > 0 ? used.toLocaleString(locale) : '待统计'} / 窗口 ${maximum.toLocaleString(locale)} Token；窗口来源：${source}`
    : `Used ${used != null && used > 0 ? used.toLocaleString(locale) : 'pending'} / window ${maximum.toLocaleString(locale)} tokens; window source: ${source}`
}

