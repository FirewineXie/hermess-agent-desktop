export function parseSessionImport(text: string): Record<string, unknown>[] {
  const input = text.trim()
  if (!input) throw new Error('导入文件为空')
  let parsed: unknown
  try { parsed = JSON.parse(input) }
  catch {
    const lines = input.split(/\r?\n/).filter(line => line.trim())
    if (lines.length < 2) throw new Error('文件不是有效的 JSON 或 JSONL')
    try { parsed = lines.map(line => JSON.parse(line)) }
    catch { throw new Error('文件不是有效的 JSON 或 JSONL') }
  }
  const rows = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { sessions?: unknown }).sessions)
      ? (parsed as { sessions: unknown[] }).sessions : [parsed]
  if (rows.length === 0 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('文件中没有有效的会话')
  }
  const ids = new Set<string>()
  for (const row of rows) {
    const id = (row as { id?: unknown }).id
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error('会话编号为空或重复')
    ids.add(id)
  }
  return rows as Record<string, unknown>[]
}
