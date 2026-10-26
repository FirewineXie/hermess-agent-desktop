import { contextDetails, contextLabel, contextPercent, type ChatUsage } from '../model'

export default function ContextUsageIndicator({ usage, language }: { usage: ChatUsage | null; language: 'zh-CN' | 'en-US' }) {
  const percent = contextPercent(usage)
  const label = contextLabel(usage, language)
  return <span className="context-indicator" tabIndex={0} aria-label={label}>
    <svg className="context-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle className="context-ring-track" cx="18" cy="18" r="15" />
      {percent !== null && <circle className="context-ring-fill" cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${percent} 100`} />}
    </svg>
    <span className="context-percent" aria-hidden="true">{percent === null ? '—' : `${percent}%`}</span>
    <span className="context-tooltip" role="tooltip">{contextDetails(usage, language)}</span>
  </span>
}
