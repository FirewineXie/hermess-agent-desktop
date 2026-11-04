import React from 'react'
import type { ModelUsageStatistics, UsagePeriodDays, UsageStatistics } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { useProfileState, workspaceKey } from '../../app/profile-scope/ProfileWorkspace'

export function useUsageStatistics(connected: boolean, profile: string | null, epoch: string | null) {
  const { usage, agentSettings } = useDesktop()
  const workspace = workspaceKey(epoch, profile)
  const [days, setDays] = useProfileState<UsagePeriodDays>(workspace, 30, 'usage:days')
  const period = `${workspace}\u0000${days}`
  const [data, setData] = useProfileState<UsageStatistics | null>(period, null, 'usage:data')
  const [modelData, setModelData] = useProfileState<ModelUsageStatistics | null>(period, null, 'usage:models')
  const [loading, setLoading] = useProfileState(period, false, 'usage:loading')
  const [failed, setFailed] = useProfileState(period, false, 'usage:failed')
  const [enabled, setEnabled] = React.useState<boolean | null>(null)
  const [revision, refresh] = React.useReducer(value => value + 1, 0)

  React.useEffect(() => {
    if (!connected || !profile) {
      setEnabled(null)
      setLoading(false)
      setFailed(false)
      return
    }
    let current = true
    setEnabled(null)
    setData(null)
    setModelData(null)
    setFailed(false)
    setLoading(true)
    const scope = { kind: 'profile' as const, profile }
    void (async () => {
      try {
        const config = await agentSettings.config(scope)
        if (!current) return
        const dashboard = config.dashboard
        const allowed = Boolean(dashboard && typeof dashboard === 'object' &&
          (dashboard as Record<string, unknown>).show_token_analytics === true)
        setEnabled(allowed)
        if (allowed) {
          const result = await usage.statistics(scope, days)
          if (current) setData(result)
        } else {
          const result = await usage.models(scope, days)
          if (current) setModelData(result)
        }
      } catch {
        if (current) setFailed(true)
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => { current = false }
  }, [connected, profile, epoch, days, revision, usage, agentSettings])

  return { days, setDays, data, modelData, loading, failed, enabled, refresh }
}
