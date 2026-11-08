import React from 'react'
import type { CodingSettings } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'

export function useCodingSettings(onDirtyChange: (value: boolean) => void, onBusyChange: (value: boolean) => void, onSaved: () => void) {
  const api = useDesktop()
  const [snapshot, setSnapshot] = React.useState<CodingSettings | null>(null)
  const [draft, setDraft] = React.useState<CodingSettings | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [extraDirty, setExtraDirty] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [saved, setSaved] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)
  const alive = React.useRef(true), operation = React.useRef(false)
  const dirty = Boolean(snapshot && draft && JSON.stringify(snapshot) !== JSON.stringify(draft))
  React.useEffect(() => { onDirtyChange(dirty || extraDirty) }, [dirty, extraDirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; onBusyChange(false); onDirtyChange(false) } }, [onBusyChange, onDirtyChange])
  const run = React.useCallback(async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(null); setSaved(false)
    try { await action() } catch (cause) { if (alive.current) setError(cause) }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }, [])
  const load = React.useCallback(() => run(async () => {
    const value = await api.coding.settings()
    if (alive.current) { setSnapshot(value); setDraft(value); setReloadKey(key => key + 1) }
  }), [api.coding, run])
  React.useEffect(() => { void load() }, [load])
  const change = (fields: Partial<CodingSettings>) => { setDraft(current => current && { ...current, ...fields }); setSaved(false) }
  const save = () => run(async () => {
    if (!draft) return
    const value = await api.coding.saveSettings(draft)
    if (alive.current) { setSnapshot(value); setDraft(value); setSaved(true); onSaved() }
  })
  return { api, snapshot, draft, busy, dirty, extraDirty, setExtraDirty, error, saved, reloadKey, run, load, change, save }
}
export type CodingSettingsController = ReturnType<typeof useCodingSettings>
