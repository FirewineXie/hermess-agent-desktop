import React from 'react'
import type { UsagePeriodDays, UsageStatistics } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'

export function useUsageStatistics(connected: boolean) {
  const { usage } = useDesktop()
  const [days, setDays] = React.useState<UsagePeriodDays>(30)
  const [data, setData] = React.useState<UsageStatistics | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [revision, refresh] = React.useReducer(value => value + 1, 0)

  React.useEffect(() => {
    if (!connected) {
      setData(null)
      setLoading(false)
      setFailed(false)
      return
    }
    let current = true
    setData(null)
    setFailed(false)
    setLoading(true)
    void usage.statistics(days).then(result => {
      if (current) setData(result)
    }).catch(() => {
      if (current) setFailed(true)
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [connected, days, revision, usage])

  return { days, setDays, data, loading, failed, refresh }
}
