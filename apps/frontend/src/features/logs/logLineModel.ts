export type LogLineLevel = 'error' | 'warning' | 'info' | 'debug'

// Hermes logging emits this timestamped prefix. Anchor the level at the
// beginning so message text such as "parse_errors=0" cannot spoof severity.
const levelToken = /^\d{4}-\d{2}-\d{2}[ T][\d:,.]+\s+(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\b/

export function classifyLogLine(line: string): LogLineLevel {
  const token = levelToken.exec(line)?.[1]
  if (token) {
    if (token === 'ERROR' || token === 'CRITICAL' || token === 'FATAL') return 'error'
    if (token === 'WARNING' || token === 'WARN') return 'warning'
    if (token === 'DEBUG') return 'debug'
    return 'info'
  }
  const upper = line.toUpperCase()
  if (/\b(ERROR|CRITICAL|FATAL)\b/.test(upper) || upper.startsWith('TRACEBACK (')) return 'error'
  if (/\b(WARNING|WARN)\b/.test(upper)) return 'warning'
  if (/\bDEBUG\b/.test(upper)) return 'debug'
  return 'info'
}
