import React from 'react'
import type { ProfilesSnapshot, ProfileCreateOptions } from '@hermess/contracts'
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
  const activeProfile = roster?.selected || null
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
        const available = new Set(latest.profiles.map(profile => profile.name))
        if (current && available.has(current)) return current
        let stored = ''
        try { stored = localStorage.getItem('hermess:viewed-profile') || '' } catch { /* optional preference */ }
        if (stored && available.has(stored)) return stored
        if (available.has(latest.selected)) return latest.selected
        return available.has('default') ? 'default' : available.values().next().value || null
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
    if (!roster?.profiles.some(profile => profile.name === name)) {
      const cause = new Error('Profile is not present in the current roster')
      setError(describeError(cause, language))
      throw cause
    }
    setViewed(name)
    try { localStorage.setItem('hermess:viewed-profile', name) } catch { /* optional preference */ }
  }

  const activate = async (name: string) => {
    if (busy || activeProfile === name) return
    if (!roster?.profiles.some(profile => profile.name === name)) throw new Error('Profile is not present in the current roster')
    const served = roster.gateways.some(gateway => gateway.profile === name || gateway.served_profiles?.includes(name))
    if (!served) throw new Error('Profile is not served by this Gateway')
    setBusy(true)
    setError('')
    try {
      await profiles.activate(name)
      const latest = await refresh()
      if (latest.selected !== name) throw new Error('Active Profile change was not confirmed')
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const create = async (name: string, options?: ProfileCreateOptions) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await profiles.create(name.trim(), options)
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

  const exportArchive = async (name: string, destination: string) => {
    if (busy) throw new Error('Profile is busy')
    setBusy(true)
    setError('')
    try {
      return await profiles.exportArchive(name, destination)
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const importArchive = async (archive: string, name?: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await profiles.importArchive(archive, name?.trim() || undefined)
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

  const renameProfileId = async (name: string, newName: string) => {
    if (busy || name === 'default') throw new Error('Profile cannot be renamed now')
    setBusy(true)
    setError('')
    try {
      const result = await profiles.renameId(name, newName.trim())
      if (viewed === name) {
        setViewed(result.name)
        try { localStorage.setItem('hermess:viewed-profile', result.name) } catch { /* optional preference */ }
      }
      if (!result.selection_persisted) setError(language === 'zh-CN'
        ? '内部标识已更新，但当前选择未能写入磁盘；下次启动可能回到 default。'
        : 'Internal ID updated, but the current selection was not persisted; the next launch may return to default.')
      try {
        let latest = await refresh()
        let served = latest.gateways.some(gateway => gateway.profile === result.name || gateway.served_profiles?.includes(result.name))
        if (!served) {
          const restarted = await restart()
          if (restarted) {
            latest = await refresh()
            served = latest.gateways.some(gateway => gateway.profile === result.name || gateway.served_profiles?.includes(result.name))
          }
        }
        if (served) setPendingName(null)
        else setPendingName(result.name)
        return { ...result, served, refreshed: true }
      } catch (cause) {
        setError(language === 'zh-CN'
          ? '内部标识已更新，但 Profile 列表刷新失败；请重新连接后核对。'
          : 'Internal ID updated, but the profile list could not refresh. Reconnect and verify it.')
        return { ...result, served: false, refreshed: false }
      }
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const saveDescription = async (name: string, description: string) => {
    if (busy) throw new Error('Profile is busy')
    setBusy(true)
    setError('')
    try {
      const result = await profiles.saveDescription(name, description)
      try { await refresh() } catch { setError(language === 'zh-CN' ? '职责说明已保存，但 Profile 列表刷新失败。' : 'Role description saved, but the profile list could not refresh.') }
      return result
    } catch (cause) {
      setError(describeError(cause, language))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const describeAuto = async (name: string, overwrite: boolean) => {
    if (busy) throw new Error('Profile is busy')
    setBusy(true)
    setError('')
    try {
      const result = await profiles.describeAuto(name, overwrite)
      if (result.ok) {
        try { await refresh() } catch { setError(language === 'zh-CN' ? '职责说明已生成，但 Profile 列表刷新失败。' : 'Role description generated, but the profile list could not refresh.') }
      }
      return result
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

  return { snapshot, activeProfile, busy, error, pendingRestart: Boolean(pendingName), refresh, select, activate, create, exportArchive, importArchive, importPackage, deleteProfile, renameProfile, renameProfileId, saveDescription, describeAuto, retryPending }
}
