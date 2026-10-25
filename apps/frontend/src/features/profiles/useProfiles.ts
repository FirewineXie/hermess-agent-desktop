import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type Options = {
  connected: boolean
  backendEpoch: string | null
  onSelected: () => void
  restart: () => Promise<unknown>
}

export function useProfiles({ connected, backendEpoch, onSelected, restart }: Options) {
  const { profiles } = useDesktop()
  const language = useLanguage()
  const [snapshot, setSnapshot] = React.useState<ProfilesSnapshot | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [pendingName, setPendingName] = React.useState<string | null>(null)
  const generation = React.useRef(0)

  const refresh = async () => {
    const request = ++generation.current
    const latest = await profiles.list()
    if (request === generation.current) setSnapshot(latest)
    return latest
  }

  React.useEffect(() => {
    if (!connected) {
      generation.current += 1
      setSnapshot(null)
      setPendingName(null)
      return
    }
    void refresh().then(latest => {
      if (pendingName && latest.gateways.some(gateway => gateway.served_profiles?.includes(pendingName))) setPendingName(null)
    }).catch(cause => setError(describeError(cause, language)))
  }, [connected, backendEpoch])

  const select = async (name: string) => {
    if (busy || snapshot?.selected === name) return
    setBusy(true)
    setError('')
    try {
      await profiles.select(name)
      onSelected()
      await refresh()
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const create = async (name: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await profiles.create(name.trim())
      let latest = await refresh()
      let served = latest.gateways.some(gateway => gateway.served_profiles?.includes(created.name))
      if (!served) {
        const restarted = await restart()
        if (!restarted) {
          setPendingName(created.name)
          return
        }
        latest = await refresh()
        served = latest.gateways.some(gateway => gateway.served_profiles?.includes(created.name))
      }
      if (!served) {
        setPendingName(created.name)
        return
      }
      await profiles.select(created.name)
      onSelected()
      await refresh()
      setPendingName(null)
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const retryPending = async () => {
    if (busy || !pendingName) return
    setBusy(true)
    setError('')
    try {
      const latest = await refresh()
      if (!latest.gateways.some(gateway => gateway.served_profiles?.includes(pendingName))) {
        const restarted = await restart()
        if (!restarted) return
      }
      await profiles.select(pendingName)
      onSelected()
      await refresh()
      setPendingName(null)
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setBusy(false)
    }
  }

  return { snapshot, busy, error, pendingRestart: Boolean(pendingName), refresh, select, create, retryPending }
}
