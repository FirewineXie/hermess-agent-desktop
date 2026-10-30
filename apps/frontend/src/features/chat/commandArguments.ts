import type { CommandCatalog } from '@hermess/contracts'

export function argumentTrigger(draft: string, caret: number) {
  const match = /^\/([^\s]+)[ \t]+([^\s]*)$/.exec(draft.slice(0, caret))
  if (!match) return null
  return { prefix: '/', command: '/' + match[1], query: match[2], start: caret - match[2].length, end: caret + (draft.slice(caret).match(/^[^\s]*/)?.[0].length || 0) }
}

export function argumentOptions(catalog: CommandCatalog, name: string): string[] {
  if (name === '/save') return ['json', 'md', 'html']
  if (['/new', '/sessions', '/model', '/history', '/resume', '/retry', '/agents', '/branch', '/stop', '/config', '/tools', '/toolsets', '/cron', '/plugins'].includes(name)) return []
  const options = catalog.commands[name]?.desktop_subcommands || catalog.sub?.[name] || catalog.sub?.[name.slice(1)] || []
  return options.filter(value => !(name === '/approvals' && value === 'off'))
}

export function argumentAllowed(catalog: CommandCatalog, name: string, arg: string): boolean {
  if (name === '/retry') return !arg.trim()
  if (name === '/agents') return !arg.trim()
  if (name === '/branch') return Array.from(arg.trim()).length <= 200
  const subcommands = catalog.commands[name]?.desktop_subcommands
  if (subcommands && !subcommands.includes(arg.trim().split(/\s+/)[0])) return false
  return name !== '/approvals' || arg.trim().toLowerCase() !== 'off'
}

export function argumentHint(catalog: CommandCatalog | null, name: string, language: 'zh-CN' | 'en-US'): string {
  if (name === '/save') return language === 'zh-CN' ? '/save json|md|html [文件名] [redact]；保存前选择本机路径，已存在的文件不会覆盖' : '/save json|md|html [filename] [redact]; choose a local path, existing files are never overwritten'
  if (name === '/resume') return language === 'zh-CN' ? '/resume 会话ID或完整名称；无参数打开历史列表' : '/resume ID or full title; no argument opens history'
  if (name === '/retry') return language === 'zh-CN' ? '/retry 重新运行上一条用户请求，不接受参数' : '/retry reruns the last user request and takes no arguments'
  if (name === '/compress') return language === 'zh-CN' ? '/compress [here N | focus 主题] [--preview]；先用 --preview 查看范围' : '/compress [here N | focus topic] [--preview]; use --preview to inspect the scope first'
  if (name === '/agents') return language === 'zh-CN' ? '/agents 查看当前会话的子代理任务，不接受参数' : '/agents shows subagent tasks for this session and takes no arguments'
  if (name === '/branch') return language === 'zh-CN' ? '/branch [标题] 从当前会话创建分支并切换，标题可选' : '/branch [title] creates and opens a branch of this session; title is optional'
  if (['/new', '/sessions', '/model', '/history', '/stop', '/config', '/tools', '/toolsets', '/cron', '/plugins'].includes(name)) return language === 'zh-CN' ? name + ' 不接受参数，请在对应界面操作' : name + ' takes no arguments; use its desktop view'
  return catalog?.pairs.find(([key]) => key === name)?.[1] || ''
}
