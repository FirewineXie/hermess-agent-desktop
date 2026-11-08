import React from 'react'
import type { CodingMessage } from '@hermess/contracts'
import type { Language } from '../../i18n'

export function formatDuration(milliseconds: number, language: Language) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60
  return language === 'zh-CN'
    ? `${hours ? `${hours} 小时 ` : ''}${minutes || hours ? `${minutes} 分钟 ` : ''}${remainder} 秒`
    : `${hours ? `${hours}h ` : ''}${minutes || hours ? `${minutes}m ` : ''}${remainder}s`
}

export default function ProgrammingTiming({ timing, running, language }: {
  timing: NonNullable<CodingMessage['timing']>; running: boolean; language: Language
}) {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, timing.started_at_ms])
  const elapsed = timing.elapsed_ms ?? (running ? now - timing.started_at_ms : undefined)
  const zh = language === 'zh-CN'
  return <p className="programming-turn-timing" role={running ? 'timer' : undefined}>
    {elapsed === undefined ? (zh ? '执行已中断 · 耗时未记录' : 'Interrupted · Duration unavailable')
      : `${running ? (zh ? '运行中' : 'Running') : (zh ? '运行耗时' : 'Run duration')} · ${formatDuration(elapsed, language)}`}
  </p>
}
