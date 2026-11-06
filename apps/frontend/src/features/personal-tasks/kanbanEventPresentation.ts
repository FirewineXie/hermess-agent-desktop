const MAX_INPUT = 32_768
const MAX_OUTPUT = 3_000
const MAX_STRING = 600
const MAX_KEYS = 24
const MAX_ITEMS = 16
const MAX_DEPTH = 4

const sensitiveKey = /(authorization|cookie|credential|password|secret|token|api[_-]?key)/i

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…（已截断）` : value
}

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[已隐藏]')
    .replace(/\b(authorization|cookie|credential|password|secret|token|api[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[已隐藏]')
}

function safeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return truncate(redactText(value), MAX_STRING)
  if (typeof value !== 'object') return truncate(String(value), MAX_STRING)
  if (depth >= MAX_DEPTH) return '…（已省略深层内容）'
  if (seen.has(value)) return '…（循环引用）'
  seen.add(value)
  if (Array.isArray(value)) {
    const rows = value.slice(0, MAX_ITEMS).map(item => safeValue(item, depth + 1, seen))
    if (value.length > MAX_ITEMS) rows.push(`…（另有 ${value.length - MAX_ITEMS} 项）`)
    return rows
  }
  const entries = Object.entries(value)
  const result: Record<string, unknown> = {}
  for (const [key, item] of entries.slice(0, MAX_KEYS)) {
    result[key] = sensitiveKey.test(key) ? '[已隐藏]' : safeValue(item, depth + 1, seen)
  }
  if (entries.length > MAX_KEYS) result['…'] = `另有 ${entries.length - MAX_KEYS} 个字段`
  return result
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload
  const source = payload.trim()
  if (!source) return null
  if (source.length > MAX_INPUT) return truncate(redactText(source), MAX_OUTPUT)
  try { return JSON.parse(source) }
  catch { return truncate(redactText(source), MAX_OUTPUT) }
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return truncate(redactText(value.trim()), 160)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export type KanbanEventPresentation = { context: string | null; payload: string | null }

export function presentKanbanEventPayload(payload: unknown): KanbanEventPresentation {
  const parsed = parsePayload(payload)
  if (parsed == null || parsed === '') return { context: null, payload: null }
  const safe = safeValue(parsed, 0, new WeakSet())
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : null
  const labels: Array<[string, string]> = [
    ['status', '状态'], ['kind', '类型'], ['severity', '级别'], ['title', '诊断'], ['reason', '原因'],
    ['assignee', '负责人'], ['reviewer', '审核人'], ['implementer', '执行人'], ['outcome', '结果'],
    ['parent', '父任务'], ['pid', 'PID'], ['exit_code', '退出码'], ['failures', '失败次数'],
  ]
  const context = record ? labels.flatMap(([key, label]) => {
    if (sensitiveKey.test(key)) return []
    const value = scalar(record[key])
    return value ? [`${label}：${value}`] : []
  }).join(' · ') || null : null
  const formatted = typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2)
  return { context, payload: truncate(formatted, MAX_OUTPUT) }
}
