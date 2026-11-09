import React from 'react'
import type { ActiveGateway, BackendInfo } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { activateWorkspaceEpoch } from '../../app/profile-scope/ProfileWorkspace'
import { displayPath } from '../../shared/displayPath'
import { useGatewayRecovery } from './useGatewayRecovery'

type Options = {
  t: (key: string, ...values: unknown[]) => string
  onReset: () => void
  gateway?: ActiveGateway
  onRestore: (info: BackendInfo, current: () => boolean) => Promise<void>
  onCancelRestore: () => void
}

export function useRuntimeController({ t, onReset, gateway, onRestore, onCancelRestore }: Options) {
  const { nativeFiles, runtime, diagnostics } = useDesktop()
  const language = useLanguage()
  const mounted = React.useRef(true)
  const lifecycle = React.useRef(0)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifecycle.current += 1 } }, [])
  const [pythonPath, setPythonPath] = React.useState('')
  const [storagePath, setStoragePath] = React.useState('')
  const [storageLocked, setStorageLocked] = React.useState(false)
  const [freshInstallation, setFreshInstallation] = React.useState<boolean | null>(gateway?.mode === 'remote' ? false : null)
  const [backend, setBackendState] = React.useState<BackendInfo | null>(gateway?.mode === 'remote'
    ? { port: 0, pid: 0, replay_epoch: gateway.replay_epoch } : null)
  const [workspaceGeneration, setWorkspaceGeneration] = React.useState(() => gateway?.mode === 'remote'
    ? activateWorkspaceEpoch(gateway.replay_epoch) : 0)
  const setBackend = (next: BackendInfo | null) => {
    if (!mounted.current) return
    setWorkspaceGeneration(activateWorkspaceEpoch(next?.replay_epoch, next === null || !next.replay_epoch))
    setBackendState(next)
  }
  const [backendStatus, setBackendStatus] = React.useState(gateway?.mode === 'remote' ? t('ui.connected') : t("ui.not.started"))
  const [busy, setBusy] = React.useState(false)
  const recovery = useGatewayRecovery({ backend, remote: gateway?.mode === 'remote', storagePath, restore: onRestore, cancelRestore: onCancelRestore, setStatus: setBackendStatus })
  const suspendRecovery = () => { lifecycle.current += 1; recovery.suspend(); setBusy(false) }
  const beginLifecycle = () => {
    suspendRecovery()
    const generation = lifecycle.current
    return () => mounted.current && generation === lifecycle.current
  }
  React.useEffect(() => {
    if (gateway?.mode === 'remote') return
    let active = true
    setBusy(true)
    setBackendStatus(t("ui.reading.startup.configuration"))
    void (async () => {
      try {
        if (import.meta.env.DEV) {
          setFreshInstallation(false)
          const defaults = await runtime.devDefaults()
          if (!active) return
          setPythonPath(displayPath(defaults.python_path))
          setStoragePath(displayPath(defaults.storage_path))
          await startBackend(defaults.storage_path, defaults.python_path)
        } else {
          const defaults = await runtime.packedDefaults()
          if (!active) return
          setFreshInstallation(!defaults.initialized)
          setStoragePath(displayPath(defaults.storage_path))
          setStorageLocked(defaults.initialized)
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

  async function startBackendOperation(selectedStoragePath: string, selectedPythonPath: string, propagate: boolean) {
    const current = beginLifecycle()
    setBusy(true)
    setBackendStatus(t("ui.starting.and.authenticating"))
    try {
      const info = import.meta.env.DEV
        ? await runtime.startDev(selectedStoragePath, selectedPythonPath)
        : await runtime.startPacked(selectedStoragePath)
      if (!current()) return null
      setBackend(info)
      recovery.connectedNow()
      setBackendStatus(t("ui.ready.websocket.ping.succeeded"))
      if (!import.meta.env.DEV) setStorageLocked(true)
      return info
    } catch (cause) {
      if (!current()) return null
      void diagnostics.recordEvent(selectedStoragePath, 'startup_failed').catch(() => {})
      if (!backend) {
        setBackend(null)
        recovery.stopped()
        onReset()
      } else recovery.disconnected()
      setBackendStatus(t("ui.startup.failed.arg", describeError(cause, language)))
      if (propagate) throw cause
      return null
    } finally { if (current()) setBusy(false) }
  }

  async function startBackend(selectedStoragePath = storagePath, selectedPythonPath = pythonPath) {
    await startBackendOperation(selectedStoragePath, selectedPythonPath, false)
  }

  async function startBackendStrict(selectedStoragePath = storagePath, selectedPythonPath = pythonPath) {
    return startBackendOperation(selectedStoragePath, selectedPythonPath, true)
  }

  async function chooseStoragePath() {
    try {
      const selected = await nativeFiles.choose({ directory: true, multiple: false, title: t("ui.choose.primary.storage.location") })
      if (typeof selected === 'string') setStoragePath(displayPath(selected))
    } catch (cause) { setBackendStatus(t("ui.failed.to.select.directory.arg", describeError(cause, language))) }
  }

  async function pingBackend() {
    const generation = lifecycle.current
    const current = () => mounted.current && generation === lifecycle.current
    setBusy(true)
    try {
      await runtime.ping()
      if (!current()) return
      setBackendStatus(t("ui.connection.healthy.websocket.ping.succeeded"))
    } catch (cause) {
      if (!current()) return
      void diagnostics.recordEvent(storagePath, 'connection_failed').catch(() => {})
      setBackendStatus(t("ui.connection.failed.arg", describeError(cause, language)))
      void recovery.recover()
    }
    finally { if (current()) setBusy(false) }
  }

  async function stopBackendOperation(propagate: boolean) {
    const current = beginLifecycle()
    const previous = backend
    setBusy(true)
    try {
      await runtime.stop()
      if (!current()) return null
      setBackend(null)
      recovery.stopped()
      onReset()
      setBackendStatus(t("ui.stopped"))
      return previous
    } catch (cause) {
      if (!current()) return null
      recovery.disconnected()
      void diagnostics.recordEvent(storagePath, 'stop_failed').catch(() => {})
      setBackendStatus(t("ui.stop.failed.arg", describeError(cause, language)))
      if (propagate) throw cause
      return null
    }
    finally { if (current()) setBusy(false) }
  }

  async function stopBackend() { await stopBackendOperation(false) }

  async function stopBackendStrict() { return stopBackendOperation(true) }

  async function restartOperation<T>(operation: () => Promise<T>, infoOf: (result: T) => BackendInfo | null, deferred: (result: T) => boolean, recoverOnFailure = false) {
    const current = beginLifecycle()
    setBusy(true)
    setBackendStatus(t('ui.channels.waiting.for.restart'))
    try {
      const result = await operation()
      if (!current()) return null
      const info = infoOf(result)
      if (info) setBackend(info)
      recovery.connectedNow()
      setBackendStatus(t(deferred(result) ? 'ui.channels.restart.deferred' : 'ui.ready.websocket.ping.succeeded'))
      return result
    } catch (cause) {
      if (!current()) return null
      try { await runtime.ping(); if (current()) recovery.connectedNow() }
      catch {
        if (current()) {
          if (recoverOnFailure) await recovery.recover()
          else recovery.disconnected()
        }
      }
      if (!current()) return null
      setBackendStatus(t('ui.startup.failed.arg', describeError(cause, language)))
      throw cause
    } finally { if (current()) setBusy(false) }
  }

  async function restartBackend() {
    const result = await restartOperation(runtime.restartGracefully, result => result.status === 'restarted' ? result.info : null, result => result.status === 'deferred')
    return result?.status === 'restarted' ? result.info : null
  }

  async function enableWebAccess() {
    return restartOperation(() => runtime.webAccess({ action: 'enable' }), result => result.restarted, () => false, true)
  }

  async function forceRestartBackend() {
    const current = beginLifecycle()
    setBusy(true)
    setBackendStatus(t('ui.channels.waiting.for.restart'))
    try {
      await runtime.stop()
      if (!current()) return null
      setBackend(null)
      const info = import.meta.env.DEV
        ? await runtime.startDev(storagePath, pythonPath)
        : await runtime.startPacked(storagePath)
      if (!current()) return null
      setBackend(info)
      recovery.connectedNow()
      setBackendStatus(t('ui.ready.websocket.ping.succeeded'))
      return info
    } catch (cause) {
      if (!current()) return null
      try { await runtime.ping(); if (current()) recovery.connectedNow() }
      catch { if (current()) recovery.disconnected() }
      if (!current()) return null
      setBackendStatus(t('ui.startup.failed.arg', describeError(cause, language)))
      throw cause
    } finally { if (current()) setBusy(false) }
  }


  return {
    pythonPath, setPythonPath, storagePath, setStoragePath, storageLocked, freshInstallation,
    backend, setBackend, workspaceGeneration, backendStatus, setBackendStatus, busy, setBusy,
    startBackend, startBackendStrict, chooseStoragePath, pingBackend, stopBackend, stopBackendStrict,
    restartBackend, forceRestartBackend, enableWebAccess,
    connected: recovery.connected, connectionState: recovery.state,
    reconnectBackend: recovery.retry, suspendRecovery,
  }
}
