import { isMap, isSeq, parseDocument } from 'yaml'

export type YamlDraftCheck = { valid: true } | { valid: false; line: number; column: number; reason: 'syntax' | 'root' }

function parseYamlDraft(text: string) {
  return parseDocument(text, { strict: true, uniqueKeys: true })
}

export function checkYamlDraft(text: string): YamlDraftCheck {
  const document = parseYamlDraft(text)
  const error = document.errors[0]
  if (error) {
    return { valid: false, line: error.linePos?.[0]?.line ?? 1, column: error.linePos?.[0]?.col ?? 1, reason: 'syntax' }
  }
  if (!isMap(document.contents)) return { valid: false, line: 1, column: 1, reason: 'root' }
  return { valid: true }
}

export function formatYamlDraft(text: string): string | null {
  if (!checkYamlDraft(text).valid) return null
  const document = parseYamlDraft(text)
  function expand(node: unknown) {
    if (isMap(node)) {
      node.flow = false
      for (const pair of node.items) { expand(pair.key); expand(pair.value) }
    } else if (isSeq(node)) {
      node.flow = false
      for (const item of node.items) expand(item)
    }
  }
  expand(document.contents)
  return document.toString({ indent: 2, lineWidth: 0 })
}
