import React from 'react'
import type { BackendInfo } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { activateWorkspaceEpoch } from '../../app/profile-scope/ProfileWorkspace'

type Options = {
  t: (key: string, ...values: unknown[]) => string
  onReset: () => void
  initialDebugMode?: boolean
}

export function useRuntimeController({ t, onReset, initialDebugMode = false }: Options) {
  const { nativeFiles, runtime, connections, diagnostics, windowChrome } = useDesktop()
  const language = useLanguage()
  const [pythonPath, setPythonPath] = React.useState('')
  const [storagePath, setStoragePath] = React.useState('')
  const [storageLocked, setStorageLocked] = React.useState(false)
  const [debugMode, setDebugMode] = React.useState(initialDebugMode)
  const [debugButtonVisible, setDebugButtonVisible] = React.useState(false)
  React.useEffect(() => {
    if (debugButtonVisible) return
    let typed = ''
    const revealDebugButton = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey ||
        (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) {
        typed = ''
        return
      }
      typed = event.key.length === 1 ? (typed + event.key.toLowerCase()).slice(-5) : ''
      if (typed === 'debug') setDebugButtonVisible(true)
    }
    document.addEventListener('keydown', revealDebugButton)
    return () => document.removeEventListener('keydown', revealDebugButton)
  }, [debugButtonVisible])
  const changeDebugMode = async (enabled: boolean) => {
    await windowChrome.setFrontendDebugEnabled(enabled)
    setDebugMode(enabled)
  }
  const [backend, setBackendState] = React.useState<BackendInfo | null>(null)
  const [workspaceGeneration, setWorkspaceGeneration] = React.useState(0)
  const setBackend = (next: BackendInfo | null) => {
    setWorkspaceGeneration(activateWorkspaceEpoch(next?.replay_epoch, next === null || !next.replay_epoch, next?.connection_id))
    setBackendState(next)
  }
  const [backendStatus, setBackendStatus] = React.useState(t("ui.not.started"))
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let active = true
    setBusy(true)
    setBackendStatus(t("ui.reading.startup.configuration"))
    void (async () => {
      try {
        if (import.meta.env.DEV) {
          const defaults = await runtime.devDefaults()
          if (!active) return
          setPythonPath(defaults.python_path)
          setStoragePath(defaults.storage_path)
          const remote = await connections.currentRemote()
          if (!active) return
          if (remote) {
            setBackend({ kind: 'remote', connection_id: remote.connectionId, replay_epoch: remote.replayEpoch, label: remote.label })
            setBackendStatus(language === 'zh-CN' ? `已恢复远端目标「${remote.label}」；如已断线，请在已保存连接中重新连接。` : `Restored remote target “${remote.label}”. Reconnect from Saved connections if disconnected.`)
            setBusy(false)
            return
          }
          await startBackend(defaults.storage_path, defaults.python_path)
        } else {
          const defaults = await runtime.packedDefaults()
          if (!active) return
          setStoragePath(defaults.storage_path)
          setStorageLocked(defaults.initialized)
          const remote = await connections.currentRemote()
          if (!active) return
          if (remote) {
            setBackend({ kind: 'remote', connection_id: remote.connectionId, replay_epoch: remote.replayEpoch, label: remote.label })
            setBackendStatus(language === 'zh-CN' ? `已恢复远端目标「${remote.label}」；如已断线，请在已保存连接中重新连接。` : `Restored remote target “${remote.label}”. Reconnect from Saved connections if disconnected.`)
            setBusy(false)
            return
          }
          await startBackend(defaults.storage_path)
        }
      } catch (cause) {
        if (active) {
          setBackendStatus(t("ui.failed.to.read.startup.configuration.arg", describeError(cause, language)))
          setBusy(false)
        }
      }
    })()
    return () => { active = false }
  }, [])

  async function startBackend(selectedStoragePath = storagePath, selectedPythonPath = pythonPath) {
    setBusy(true)
    setBackendStatus(t("ui.starting.and.authenticating"))
    try {
      const info = import.meta.env.DEV
        ? await runtime.startDev(selectedStoragePath, selectedPythonPath)
        : await runtime.startPacked(selectedStoragePath)
      setBackend(info)
      setBackendStatus(t("ui.ready.websocket.ping.succeeded"))
      if (!import.meta.env.DEV) setStorageLocked(true)
    } catch (cause) {
      void diagnostics.recordEvent(selectedStoragePath, 'startup_failed').catch(() => {})
      if (!backend) {
        setBackend(null)
        onReset()
      }
      setBackendStatus(t("ui.startup.failed.arg", describeError(cause, language)))
    } finally { setBusy(false) }
  }

  async function chooseStoragePath() {
    try {
      const selected = await nativeFiles.choose({ directory: true, multiple: false, title: t("ui.choose.primary.storage.location") })
      if (typeof selected === 'string') setStoragePath(selected)
    } catch (cause) { setBackendStatus(t("ui.failed.to.select.directory.arg", describeError(cause, language))) }
  }

  async function pingBackend() {
    setBusy(true)
    try {
      await runtime.ping()
      setBackendStatus(t("ui.connection.healthy.websocket.ping.succeeded"))
    } catch (cause) {
      void diagnostics.recordEvent(storagePath, 'connection_failed').catch(() => {})
      setBackendStatus(t("ui.connection.failed.arg", describeError(cause, language)))
    }
    finally { setBusy(false) }
  }

  async function stopBackend() {
    setBusy(true)
    try {
      await runtime.stop()
      setBackend(null)
      onReset()
      setBackendStatus(t("ui.stopped"))
    } catch (cause) {
      void diagnostics.recordEvent(storagePath, 'stop_failed').catch(() => {})
      setBackendStatus(t("ui.stop.failed.arg", describeError(cause, language)))
    }
    finally { setBusy(false) }
  }

  async function restartBackend() {
    setBusy(true)
    setBackendStatus(t('ui.channels.waiting.for.restart'))
    try {
      const result = await runtime.restartGracefully()
      if (result.status === 'deferred') {
        setBackendStatus(t('ui.channels.restart.deferred'))
        return null
      }
      const info = result.info
      setBackend(info)
      setBackendStatus(t('ui.ready.websocket.ping.succeeded'))
      return info
    } catch (cause) {
      try { await runtime.ping() }
      catch { setBackend(null); onReset() }
      setBackendStatus(t('ui.startup.failed.arg', describeError(cause, language)))
      throw cause
    } finally { setBusy(false) }
  }

  async function forceRestartBackend() {
    setBusy(true)
    setBackendStatus(t('ui.channels.waiting.for.restart'))
    try {
      await runtime.stop()
      setBackend(null)
      const info = import.meta.env.DEV
        ? await runtime.startDev(storagePath, pythonPath)
        : await runtime.startPacked(storagePath)
      setBackend(info)
      setBackendStatus(t('ui.ready.websocket.ping.succeeded'))
      return info
    } catch (cause) {
      try { await runtime.ping() }
      catch { setBackend(null); onReset() }
      setBackendStatus(t('ui.startup.failed.arg', describeError(cause, language)))
      throw cause
    } finally { setBusy(false) }
  }


  return {
    pythonPath, setPythonPath, storagePath, setStoragePath, storageLocked, debugMode, debugButtonVisible, changeDebugMode,
    backend, setBackend, workspaceGeneration, backendStatus, setBackendStatus, busy, setBusy,
    startBackend, chooseStoragePath, pingBackend, stopBackend, restartBackend, forceRestartBackend,
  }
}
