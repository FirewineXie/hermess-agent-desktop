export type ConsoleFrame = {
  type: 'ready' | 'output' | 'error' | 'confirm_required' | 'complete' | 'clear' | 'pong'
  profile?: string
  prompt?: string
  data?: string
  stream?: string
  message?: string
  command?: string
  status?: string
}

const frameTypes = new Set<ConsoleFrame['type']>([
  'ready', 'output', 'error', 'confirm_required', 'complete', 'clear', 'pong',
])

export function parseConsoleFrame(raw: string): ConsoleFrame | null {
  if (raw.length > 256 * 1024) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== 'object' || !frameTypes.has(value.type as ConsoleFrame['type'])) return null
    const frame: ConsoleFrame = { type: value.type as ConsoleFrame['type'] }
    for (const key of ['profile', 'prompt', 'data', 'stream', 'message', 'command', 'status'] as const) {
      const item = value[key]
      if (typeof item === 'string' && item.length <= 256 * 1024) frame[key] = item
    }
    return frame
  } catch { return null }
}
