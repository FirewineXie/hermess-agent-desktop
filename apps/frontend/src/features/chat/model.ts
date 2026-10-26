import type { CommandCatalog, ChatUsage } from '@hermess/contracts'
export type { PendingAttachment, CommandCatalog, CommandResult, ResumeResult, ChatUsage } from '@hermess/contracts'
import commandDescriptionsZh from '../../locales/app/command-descriptions.zh-CN.json'
import { translateApp } from '../../i18n'

export type ComposerChoice = { name: string; description: string; skill: boolean; available: boolean; availability: string }
export const DESKTOP_GATEWAY_COMMANDS = new Set([
  'help', 'status', 'context', 'version', 'whoami', 'usage', 'insights', 'profile', 'diff',
  'memory', 'kanban', 'topup', 'suggestions', 'bundles', 'skills', 'title', 'goal', 'subgoal',
  'loop', 'heartbeat', 'review', 'refine', 'debug', 'curator', 'login', 'autoprune',
  'plan', 'learn', 'init', 'moa', 'blueprint', 'egress', 'reasoning', 'voice', 'approvals',
  'codex-runtime', 'footer', 'busy', 'verbose', 'yolo', 'fast', 'personality',
  'approve', 'deny', 'platforms', 'new', 'sessions', 'model',
])

export function commandSupported(catalog: CommandCatalog, name: string): boolean {
  if (Object.hasOwn(catalog.skills, name) || DESKTOP_GATEWAY_COMMANDS.has(name.slice(1))) return true
  if (Object.hasOwn(catalog.plugin_commands || {}, name.slice(1))) return true
  return Boolean(catalog.categories?.some(category =>
    category.name === 'User commands' && category.pairs.some(([key]) => key === name)))
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
  const match = /(^|\s)([\/@])([^\s]*)$/.exec(draft.slice(0, position))
  if (!match) return null
  const start = position - match[2].length - match[3].length
  if (match[2] === '/' && start !== 0) return null
  return { prefix: match[2], query: match[3], start, end: position }
}

export function commandChoices(catalog: CommandCatalog, trigger: NonNullable<ReturnType<typeof composerTrigger>>, language: 'zh-CN' | 'en-US'): ComposerChoice[] {
  const { prefix, query } = trigger
  return catalog.pairs.flatMap(([name, description]) => {
    const skill = Object.hasOwn(catalog.skills, name)
    if (prefix === '@' && !skill) return []
    if (!name.slice(1).toLowerCase().includes(query.toLowerCase())) return []
    const localized = language === 'zh-CN' ? commandDescriptionsZh[name as keyof typeof commandDescriptionsZh] : undefined
    const modelDescription = name === '/model'
      ? translateApp(language, "ui.open.model.settings.saved.defaults.apply.to.new.sessions")
      : undefined
    return [{
      name: prefix === '@' ? `@${name.slice(1)}` : name,
      description: modelDescription || localized || description,
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

