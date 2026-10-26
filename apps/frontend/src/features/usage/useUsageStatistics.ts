import React from 'react'
import type { UsagePeriodDays, UsageStatistics } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'

export function useUsageStatistics(connected: boolean, profile: string | null, epoch: string | null) {
  const { usage } = useDesktop()
  const workspace = workspaceKey(epoch, profile)
  const [days, setDays] = useProfileState<UsagePeriodDays>(workspace, 30, 'usage:days')
  const period = `${workspace}\u0000${days}`
  const [data, setData] = useProfileState<UsageStatistics | null>(period, null, 'usage:data')
  const [loading, setLoading] = useProfileState(period, false, 'usage:loading')
  const [failed, setFailed] = useProfileState(period, false, 'usage:failed')
  const [revision, refresh] = React.useReducer(value => value + 1, 0)

  React.useEffect(() => {
    if (!connected || !profile) {
      setLoading(false)
      setFailed(false)
      return
    }
    let current = true
    setFailed(false)
    setLoading(true)
    void usage.statistics({ kind: 'profile', profile }, days).then(result => {
      if (current) setData(result)
    }).catch(() => {
      if (current) setFailed(true)
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [connected, profile, epoch, days, revision, usage])

  return { days, setDays, data, loading, failed, refresh }
}
