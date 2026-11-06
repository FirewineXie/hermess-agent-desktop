export type AssistantCopyState = 'idle' | 'copied' | 'failed'

export function assistantCopyLabel(language: 'zh-CN' | 'en-US', state: AssistantCopyState): string {
  const labels = language === 'zh-CN'
    ? { idle: '复制回复', copied: '已复制', failed: '复制失败' }
    : { idle: 'Copy reply', copied: 'Copied', failed: 'Copy failed' }
  return labels[state]
}

export async function copyAssistantText(text: string, writeText: (value: string) => Promise<void>): Promise<AssistantCopyState> {
  if (!text.trim()) return 'failed'
  try {
    await writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
