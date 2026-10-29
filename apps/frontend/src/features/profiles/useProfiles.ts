import React from 'react'
import type { ProfilesSnapshot, ProfilePresetSelection } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type Options = {
  connected: boolean
  backendEpoch: string | null
  restart: () => Promise<unknown>
}

export function useProfiles({ connected, backendEpoch, restart }: Options) {
  const { profiles } = useDesktop()
  const language = useLanguage()
  const [roster, setRoster] = React.useState<ProfilesSnapshot | null>(null)
  const [viewed, setViewed] = React.useState<string | null>(null)
  const snapshot = React.useMemo(() => roster && viewed ? { ...roster, selected: viewed } : roster, [roster, viewed])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [pendingName, setPendingName] = React.useState<string | null>(null)
  const generation = React.useRef(0)

  const refresh = async () => {
    const request = ++generation.current
    const latest = await profiles.list()
    if (request === generation.current) {
      setRoster(latest)
      setViewed(current => {
        const served = new Set(latest.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]))
        if (current && served.has(current)) return current
        let stored = ''
        try { stored = localStorage.getItem('hermess:viewed-profile') || '' } catch { /* optional preference */ }
        if (stored && served.has(stored)) return stored
        if (served.has(latest.selected)) return latest.selected
        return served.has('default') ? 'default' : served.values().next().value || null
      })
    }
    return latest
  }

  React.useEffect(() => {
    if (!connected) {
      generation.current += 1
      setRoster(null)
      setPendingName(null)
      return
    }
    let active = true
    void refresh().then(latest => {
      if (active && pendingName && latest.gateways.some(gateway => gateway.profile === pendingName || gateway.served_profiles?.includes(pendingName))) setPendingName(null)
    }).catch(cause => { if (active) setError(describeError(cause, language)) })
    return () => { active = false }
  }, [connected, backendEpoch])

  const select = async (name: string) => {
    if (snapshot?.selected === name) return
    setError('')
    const served = roster?.gateways.some(gateway => gateway.profile === name || gateway.served_profiles?.includes(name))
    if (!served) {
      const cause = new Error('Profile is not served by this Gateway')
      setError(describeError(cause, language))
      throw cause
    }
    setViewed(name)
    try { localStorage.setItem('hermess:viewed-profile', name) } catch { /* optional preference */ }
  }

  const create = async (name: string, preset?: ProfilePresetSelection) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await profiles.create(name.trim(), preset)
      const warnings = created.warnings || []
      if (warnings.length) {
        const details = warnings.map(warning => {
          if (warning === 'personality') return language === 'zh-CN' ? '性格' : 'personality'
          if (warning === 'skills') return 'Skill'
          if (warning.startsWith('skills_missing:')) return `${language === 'zh-CN' ? '缺少 Skill' : 'Missing skills'} ${warning.slice(15)}`
          if (warning.startsWith('mcp:')) return `MCP ${warning.slice(4)}`
          return warning
        })
        setError(language === 'zh-CN'
          ? `Profile 已创建，但以下设置未完成：${details.join('、')}`
          : `Profile created, but some settings need attention: ${details.join(', ')}`)
      }
      let latest = await refresh()
      let served = latest.gateways.some(gateway => gateway.profile === created.name || gateway.served_profiles?.includes(created.name))
      if (!served) {
        const restarted = await restart()
        if (!restarted) {
          setPendingName(created.name)
          return { ...created, served: false }
        }
        latest = await refresh()
        served = latest.gateways.some(gateway => gateway.profile === created.name || gateway.served_profiles?.includes(created.name))
      }
      if (!served) {
        setPendingName(created.name)
        return { ...created, served: false }
      }
      setViewed(created.name)
      try { localStorage.setItem('hermess:viewed-profile', created.name) } catch { /* optional preference */ }
      setPendingName(null)
      return { ...created, served: true }
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const importPackage = async (path: string, name: string, digest: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await profiles.importPackage(path, name, digest)
      let latest = await refresh()
      let served = latest.gateways.some(gateway => gateway.profile === created.name || gateway.served_profiles?.includes(created.name))
      if (!served) {
        const restarted = await restart()
        if (restarted) {
          latest = await refresh()
          served = latest.gateways.some(gateway => gateway.profile === created.name || gateway.served_profiles?.includes(created.name))
        }
      }
      if (served) {
        setViewed(created.name)
        try { localStorage.setItem('hermess:viewed-profile', created.name) } catch { /* optional preference */ }
        setPendingName(null)
      } else setPendingName(created.name)
      return { ...created, served }
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const deleteProfile = async (name: string) => {
    if (busy || name === 'default') throw new Error('Profile cannot be deleted now')
    setBusy(true)
    setError('')
    try {
      const result = await profiles.delete(name)
      if (viewed === name) {
        setViewed('default')
        try { localStorage.setItem('hermess:viewed-profile', 'default') } catch { /* optional preference */ }
      }
      let refreshed = true
      try {
        await refresh()
      } catch (cause) {
        refreshed = false
        setError(describeError(cause, language))
      }
      return { ...result, refreshed }
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const renameProfile = async (name: string, displayName: string) => {
    if (busy) throw new Error('Profile is busy')
    setBusy(true)
    setError('')
    try {
      const result = await profiles.setDisplayName(name, displayName.trim())
      let refreshed = true
      try {
        await refresh()
      } catch (cause) {
        refreshed = false
        setError(describeError(cause, language))
      }
      return { ...result, refreshed }
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
      let latest = await refresh()
      if (!latest.gateways.some(gateway => gateway.profile === pendingName || gateway.served_profiles?.includes(pendingName))) {
        const restarted = await restart()
        if (!restarted) return
        latest = await refresh()
      }
      if (!latest.gateways.some(gateway => gateway.profile === pendingName || gateway.served_profiles?.includes(pendingName))) {
        setError(describeError(new Error('Profile is not served by this Gateway'), language))
        return
      }
      setViewed(pendingName)
      try { localStorage.setItem('hermess:viewed-profile', pendingName) } catch { /* optional preference */ }
      setPendingName(null)
    } catch (cause) {
      setError(describeError(cause, language))
    } finally {
      setBusy(false)
    }
  }

  return { snapshot, busy, error, pendingRestart: Boolean(pendingName), refresh, select, create, importPackage, deleteProfile, renameProfile, retryPending }
}
