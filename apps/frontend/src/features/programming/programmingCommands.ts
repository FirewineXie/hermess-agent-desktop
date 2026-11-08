import type { CodingCommand } from '@hermess/contracts'

export function parseProgrammingCommand(text: string): { command?: CodingCommand; error?: string } {
  const match = text.trim().match(/^\/(goal|plan|compact|review)(?:\s+([\s\S]*))?$/)
  if (!match) return {}
  const [, name, raw = ''] = match
  const argument = raw.trim()
  if (name === 'compact') return argument ? { error: '/compact 不接受参数。' } : { command: { type: 'compact' } }
  if (name === 'plan') return { command: { type: 'plan', mode: ['off', 'default'].includes(argument) ? 'default' : 'plan',
    ...(!argument || ['off', 'default', 'on'].includes(argument) ? {} : { prompt: argument }) } }
  if (name === 'goal') {
    if (!argument || ['get', 'pause', 'resume', 'clear'].includes(argument)) return { command: { type: 'goal', action: (argument || 'get') as 'get' | 'pause' | 'resume' | 'clear' } }
    const budgetMatch = argument.match(/(?:^|\s)--budget(?:\s+(\S+))?(?=\s|$)/)
    const budget = budgetMatch ? Number(budgetMatch[1]) : undefined
    if (budgetMatch && (!Number.isSafeInteger(budget) || budget! <= 0)) return { error: '预算必须是正整数，例如 /goal --budget 50000 完成任务。' }
    const objective = budgetMatch ? argument.replace(budgetMatch[0], ' ').trim() : argument
    if (!objective || Array.from(objective).length > 8192) return { error: '请在 /goal 后填写目标与验收条件，长度不超过 8192 字符。' }
    return { command: { type: 'goal', action: 'set', objective, ...(budget === undefined ? {} : { token_budget: budget }) } }
  }
  if (!argument) return { command: { type: 'review', target: { type: 'uncommittedChanges' } } }
  const target = argument.match(/^--(base|commit|custom)(?:\s+([\s\S]*))?$/)
  if (target) {
    const value = (target[2] || '').trim()
    if (!value) return { error: `请填写 --${target[1]} 的参数。` }
    if (target[1] === 'base') return { command: { type: 'review', target: { type: 'baseBranch', branch: value } } }
    if (target[1] === 'commit') return /^[\da-f]{4,64}$/i.test(value) ? { command: { type: 'review', target: { type: 'commit', sha: value, title: null } } } : { error: '提交参数必须是 4 至 64 位十六进制 SHA。' }
    return { command: { type: 'review', target: { type: 'custom', instructions: value } } }
  }
  if (argument.startsWith('--')) return { error: '/review 支持 --base、--commit 和 --custom。' }
  return { command: { type: 'review', target: { type: 'custom', instructions: argument } } }
}
