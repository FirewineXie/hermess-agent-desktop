import React from 'react'
import type { ProductInfo, UpdateDownloadStatus, UpdateLookup } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { defaultUpdateChannel, selectUpdate, type UpdateChannel } from './updateRules'
import { automaticUpdateCheckDelay } from './updateSchedule'

const CHANNEL_KEY = 'hermess-desktop-update-channel'
const LAST_AUTOMATIC_CHECK_KEY = 'hermess-desktop-last-automatic-update-check'
const emptyDownload: UpdateDownloadStatus = { state: 'idle', tagName: '', assetId: 0, downloaded: 0, total: 0, path: null, error: null }

function mergeDownload(previous: UpdateDownloadStatus, incoming: UpdateDownloadStatus): UpdateDownloadStatus {
  if (previous.tagName !== incoming.tagName || previous.assetId !== incoming.assetId) return incoming
  if (previous.state === 'completed' && incoming.state === 'downloading') return previous
  if (previous.state === 'failed' && incoming.state === 'downloading') return previous
  return { ...incoming, downloaded: Math.max(previous.downloaded, incoming.downloaded) }
}

function savedChannel(): UpdateChannel | null {
  const value = localStorage.getItem(CHANNEL_KEY)
  return value === 'stable' || value === 'rc' ? value : null
}

function savedAutomaticCheckAt(): number | null {
  const value = Number(localStorage.getItem(LAST_AUTOMATIC_CHECK_KEY))
  return Number.isFinite(value) && value > 0 ? value : null
}

export function useUpdateStatus() {
  const { about } = useDesktop()
  const [info, setInfo] = React.useState<ProductInfo | null>(null)
  const [infoError, setInfoError] = React.useState<unknown>(null)
  const [channel, setChannel] = React.useState<UpdateChannel | null>(savedChannel)
  const [lookup, setLookup] = React.useState<UpdateLookup | null>(null)
  const [lookupError, setLookupError] = React.useState<unknown>(null)
  const [checking, setChecking] = React.useState(false)
  const [download, setDownload] = React.useState<UpdateDownloadStatus>(emptyDownload)
  const [downloadError, setDownloadError] = React.useState<unknown>(null)
  const checkingRef = React.useRef(false)

  React.useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void about.onUpdateDownloadStatus(status => { if (active) setDownload(previous => mergeDownload(previous, status)) })
      .then(stop => {
        if (!active) { stop(); return }
        unsubscribe = stop
        void about.getUpdateDownloadStatus().then(status => {
          if (active) setDownload(previous => mergeDownload(previous, status))
        }).catch(() => {})
      }).catch(() => {})
    return () => { active = false; unsubscribe?.() }
  }, [about])

  const startDownload = React.useCallback(async (tagName: string, assetId: number) => {
    setDownloadError(null)
    setDownload(emptyDownload)
    try {
      const status = await about.startUpdateDownload(tagName, assetId)
      setDownload(previous => mergeDownload(previous, status))
    } catch (cause) { setDownloadError(() => cause) }
  }, [about])

  React.useEffect(() => {
    let active = true
    void about.productInfo().then(value => { if (active) setInfo(value) })
      .catch(cause => { if (active) setInfoError(() => cause) })
    return () => { active = false }
  }, [about])

  const checkUpdates = React.useCallback(async () => {
    if (!info || info.version === '0.0.0' || checkingRef.current) return
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
  }, [about, info])

  React.useEffect(() => {
    if (!info || info.version === '0.0.0') return
    let active = true
    let timer: number | undefined
    const schedule = () => {
      const delay = automaticUpdateCheckDelay(savedAutomaticCheckAt(), Date.now())
      timer = window.setTimeout(async () => {
        if (!active) return
        localStorage.setItem(LAST_AUTOMATIC_CHECK_KEY, String(Date.now()))
        await checkUpdates()
        if (active) schedule()
      }, delay)
    }
    schedule()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [checkUpdates, info])

  const effectiveChannel = channel ?? defaultUpdateChannel(info?.version ?? '')
  const candidate = info && info.version !== '0.0.0' && lookup?.status === 'available'
    ? selectUpdate(info.version, effectiveChannel, lookup.releases)
    : null

  function changeChannel(next: UpdateChannel) {
    localStorage.setItem(CHANNEL_KEY, next)
    setChannel(next)
  }

  return { info, infoError, effectiveChannel, changeChannel, lookup, lookupError, checking, checkUpdates, candidate, download, downloadError, startDownload }
}

export type UpdateStatus = ReturnType<typeof useUpdateStatus>
