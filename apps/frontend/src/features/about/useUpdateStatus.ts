import React from 'react'
import type { ProductInfo, UpdateLookup } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { defaultUpdateChannel, selectUpdate, type UpdateChannel } from './updateRules'

const CHANNEL_KEY = 'hermess-desktop-update-channel'
const CHECK_INTERVAL_MS = 60 * 60 * 1000

function savedChannel(): UpdateChannel | null {
  const value = localStorage.getItem(CHANNEL_KEY)
  return value === 'stable' || value === 'rc' ? value : null
}

export function useUpdateStatus() {
  const { about } = useDesktop()
  const [info, setInfo] = React.useState<ProductInfo | null>(null)
  const [infoError, setInfoError] = React.useState<unknown>(null)
  const [channel, setChannel] = React.useState<UpdateChannel | null>(savedChannel)
  const [lookup, setLookup] = React.useState<UpdateLookup | null>(null)
  const [lookupError, setLookupError] = React.useState<unknown>(null)
  const [checking, setChecking] = React.useState(false)
  const checkingRef = React.useRef(false)

  React.useEffect(() => {
    let active = true
    void about.productInfo().then(value => { if (active) setInfo(value) })
      .catch(cause => { if (active) setInfoError(() => cause) })
    return () => { active = false }
  }, [about])

  const checkUpdates = React.useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setLookupError(null)
    try {
      setLookup(await about.checkUpdates())
    } catch (cause) {
      setLookup(null)
      setLookupError(() => cause)
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }, [about])

  React.useEffect(() => {
    void checkUpdates()
    const timer = window.setInterval(() => void checkUpdates(), CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [checkUpdates])

  const effectiveChannel = channel ?? defaultUpdateChannel(info?.version ?? '')
  const candidate = info && lookup?.status === 'available'
    ? selectUpdate(info.version, effectiveChannel, lookup.releases)
    : null

  function changeChannel(next: UpdateChannel) {
    localStorage.setItem(CHANNEL_KEY, next)
    setChannel(next)
  }

  return { info, infoError, effectiveChannel, changeChannel, lookup, lookupError, checking, checkUpdates, candidate }
}

export type UpdateStatus = ReturnType<typeof useUpdateStatus>
