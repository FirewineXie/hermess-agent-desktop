import type { DesktopApi, DesktopFailure, SessionScope } from '@hermess/contracts'

export type SaveFormat = 'json' | 'md' | 'html'

export function parseSaveArgs(arg: string): { format: SaveFormat; filename?: string; redact: boolean } | null {
  const parts = arg.trim().split(/\s+/).filter(Boolean)
  if (!['json', 'md', 'html'].includes(parts[0]) || parts.length > 3) return null
  const format = parts.shift() as SaveFormat
  const redact = ['redact', '--redact'].includes(parts.at(-1)?.toLowerCase() || '')
  if (redact) parts.pop()
  if (parts.length > 1 || parts[0] && ['redact', '--redact'].includes(parts[0].toLowerCase())) return null
  return { format, filename: parts[0], redact }
}

export async function executeSaveCommand(
  exportSession: DesktopApi['chat']['exportSession'], scope: SessionScope | null, arg: string,
): Promise<{ kind: 'usage' | 'missing' | 'cancelled' | 'saved'; path?: string }> {
  const parsed = parseSaveArgs(arg)
  if (!parsed) return { kind: 'usage' }
  if (!scope) return { kind: 'missing' }
  const path = await exportSession(scope, parsed.format, parsed.redact, parsed.filename)
  return path ? { kind: 'saved', path } : { kind: 'cancelled' }
}

export function saveCommandStatus(kind: 'usage' | 'missing' | 'saved', language: 'zh-CN' | 'en-US', path?: string): string {
  if (kind === 'usage') return language === 'zh-CN' ? '用法：/save json|md|html [文件名] [redact]' : 'Usage: /save json|md|html [filename] [redact]'
  if (kind === 'missing') return language === 'zh-CN' ? '当前没有可导出的会话。' : 'There is no current session to export.'
  return language === 'zh-CN' ? `会话已导出：${path}` : `Session exported: ${path}`
}

export function saveCommandConflict(cause: unknown, language: 'zh-CN' | 'en-US'): string | null {
  const failure = cause as Partial<DesktopFailure> | null
  return failure?.kind === 'desktop_failure' && failure.code === 'conflict' && failure.category === 'validation'
    ? language === 'zh-CN' ? '目标文件已存在，请选择新文件名。' : 'The selected file already exists. Choose a new filename.'
    : null
}

export async function runSaveCommand(options: {
  arg: string
  exportSession: DesktopApi['chat']['exportSession']
  scope: SessionScope | null
  isCurrent: () => boolean
  language: 'zh-CN' | 'en-US'
  busy: { current: boolean }
  setBusy: (value: boolean) => void
  setDraft: (value: string) => void
  setStatus: (value: string) => void
  describeError: (cause: unknown) => string
}): Promise<boolean> {
  options.busy.current = true
  options.setBusy(true)
  try {
    const result = await executeSaveCommand(options.exportSession, options.scope, options.arg)
    if (!options.isCurrent()) return false
    if (result.kind !== 'cancelled') options.setStatus(saveCommandStatus(result.kind, options.language, result.path))
    if (result.kind !== 'saved') return false
    options.setDraft('')
    return true
  } catch (cause) {
    if (options.isCurrent()) options.setStatus(saveCommandConflict(cause, options.language) || options.describeError(cause))
    return false
  } finally {
    options.busy.current = false
    options.setBusy(false)
  }
}
