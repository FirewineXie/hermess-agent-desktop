import React from 'react'
import type { RuntimeProbe, BundledToolsInventory, DownloadableTool } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

type ToolsState = {
  probes: RuntimeProbe[]
  probeError: string
  bundledTools: BundledToolsInventory | null
  bundledToolsError: string
  downloadableTools: DownloadableTool[]
  downloadableToolsError: string
  loading: boolean
  installingTool: string
  installError: string
  installedTool: string
}

// These programs belong to the desktop installation, not to an Agent Profile.
let snapshot: ToolsState = {
  probes: [], probeError: '', bundledTools: null, bundledToolsError: '',
  downloadableTools: [], downloadableToolsError: '', loading: false,
  installingTool: '', installError: '', installedTool: '',
}
const listeners = new Set<() => void>()
let loadedEpoch: string | null = null
let loadedGeneration: number | null = null
let requestVersion = 0
let runtimeGeneration = 0

function update(patch: Partial<ToolsState>) {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot() { return snapshot }

export function useToolsController(connected: boolean, epoch: string | null, generation: number) {
  const { runtime, tools } = useDesktop()
  const language = useLanguage()
  const state = React.useSyncExternalStore(subscribe, getSnapshot)

  async function refresh() {
    if (!connected) return
    const request = ++requestVersion
    update({ loading: true, probeError: '', bundledToolsError: '', downloadableToolsError: '' })
    const [probes, bundled, downloadable] = await Promise.allSettled([
      runtime.probeLocalTools(), tools.listBundledTools(), tools.listDownloadableTools(),
    ])
    if (request !== requestVersion) return
    update({
      probes: probes.status === 'fulfilled' ? probes.value : [],
      probeError: probes.status === 'rejected' ? describeError(probes.reason, language) : '',
      bundledTools: bundled.status === 'fulfilled' ? bundled.value : null,
      bundledToolsError: bundled.status === 'rejected' ? describeError(bundled.reason, language) : '',
      downloadableTools: downloadable.status === 'fulfilled' ? downloadable.value : [],
      downloadableToolsError: downloadable.status === 'rejected' ? describeError(downloadable.reason, language) : '',
      loading: false,
    })
  }

  async function installTool(name: string) {
    if (snapshot.installingTool) return
    const generation = runtimeGeneration
    update({ installingTool: name, installError: '', installedTool: '' })
    try {
      await tools.installDownloadableTool(name)
      if (generation !== runtimeGeneration) return
      update({ installedTool: name })
      await refresh()
    } catch (cause) {
      if (generation === runtimeGeneration) update({ installError: describeError(cause, language) })
    } finally {
      if (generation === runtimeGeneration) update({ installingTool: '' })
    }
  }

  React.useEffect(() => {
    if (!connected) {
      ++runtimeGeneration
      ++requestVersion
      loadedEpoch = null
      loadedGeneration = null
      update({
        probes: [], probeError: '', bundledTools: null, bundledToolsError: '',
        downloadableTools: [], downloadableToolsError: '', loading: false,
        installingTool: '', installError: '', installedTool: '',
      })
      return
    }
    const currentEpoch = epoch || 'connected'
    if (loadedEpoch === currentEpoch && loadedGeneration === generation) return
    ++runtimeGeneration
    if (loadedEpoch !== null) {
      ++requestVersion
      update({
        probes: [], probeError: '', bundledTools: null, bundledToolsError: '',
        downloadableTools: [], downloadableToolsError: '', installedTool: '', installError: '',
      })
    }
    loadedEpoch = currentEpoch
    loadedGeneration = generation
    void refresh()
  }, [connected, epoch, generation])

  return { ...state, refresh, installTool }
}
