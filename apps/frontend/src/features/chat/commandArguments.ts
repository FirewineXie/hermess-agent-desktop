import type { CommandCatalog } from '@hermess/contracts'

export function argumentTrigger(draft: string, caret: number) {
  const match = /^\/([^\s]+)[ \t]+([^\s]*)$/.exec(draft.slice(0, caret))
  if (!match) return null
  return { prefix: '/', command: '/' + match[1], query: match[2], start: caret - match[2].length, end: caret + (draft.slice(caret).match(/^[^\s]*/)?.[0].length || 0) }
}

export function argumentOptions(catalog: CommandCatalog, name: string): string[] {
  if (['/new', '/sessions', '/model', '/history', '/resume', '/stop', '/config', '/tools', '/cron', '/plugins'].includes(name)) return []
  const options = catalog.commands[name]?.desktop_subcommands || catalog.sub?.[name] || catalog.sub?.[name.slice(1)] || []
  return options.filter(value => !(name === '/approvals' && value === 'off'))
}

export function argumentAllowed(catalog: CommandCatalog, name: string, arg: string): boolean {
  const subcommands = catalog.commands[name]?.desktop_subcommands
  if (subcommands && !subcommands.includes(arg.trim().split(/\s+/)[0])) return false
  return name !== '/approvals' || arg.trim().toLowerCase() !== 'off'
}

export function argumentHint(catalog: CommandCatalog | null, name: string, language: 'zh-CN' | 'en-US'): string {
  if (name === '/resume') return language === 'zh-CN' ? '/resume 会话ID或完整名称；无参数打开历史列表' : '/resume ID or full title; no argument opens history'
  if (['/new', '/sessions', '/model', '/history', '/stop', '/config', '/tools', '/cron', '/plugins'].includes(name)) return language === 'zh-CN' ? name + ' 不接受参数，请在对应界面操作' : name + ' takes no arguments; use its desktop view'
  return catalog?.pairs.find(([key]) => key === name)?.[1] || ''
}
