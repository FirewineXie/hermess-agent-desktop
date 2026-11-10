import React from 'react'
import { assertDashboardPluginBodyProfile, createDashboardPluginApi, dashboardPluginApiPath } from './dashboardPluginApi'
import { useDesktop } from '../../app/DesktopContext'
import { changeLanguage, useLanguage } from '../../i18n'
import type { DashboardPluginSocket, DashboardPluginSocketEvent, ProfileScope } from '@hermess/contracts'
import { localizeAchievementPayload, localizeDashboardPluginLabel } from './achievementLocalization'
import { syncDashboardPluginLanguage, useDashboardPluginI18n } from './dashboardI18n'
import { DashboardPluginRuntime } from './dashboardPluginRuntime'
import { dashboardPluginResponse } from './dashboardPluginResponse'
import type { DashboardPluginResponsePayload } from './dashboardPluginResponse'
import { DashboardPluginToast as Toast } from './dashboardPluginSdkComponents'
import { dashboardIsoTimeAgo, dashboardTimeAgo } from './dashboardPluginSdkUtils'
import { dashboardPluginDefinition, dashboardPluginEntryKey } from './dashboardPluginDefinition'
import type { DashboardPluginAssets, DashboardPluginManifest } from './dashboardPluginDefinition'
import './dashboard-plugin-host.css'

export type { DashboardPluginManifest } from './dashboardPluginDefinition'

type PluginComponent = React.ComponentType<Record<string, never>>
type RegistryListener = () => void
const registered = new Map<string, PluginComponent>()
const registeredSlots = new Map<string, Map<string, React.ComponentType>>()
const listeners = new Set<RegistryListener>()
const refreshListeners = new Set<(profile: string, reload: boolean) => void>()
const pluginAssets = new Map<string, DashboardPluginAssets>()
let pluginManifests: DashboardPluginManifest[] = []
let pluginDiscoveryError = ''
let registryProfile = ''
let activeRuntime: DashboardPluginRuntime | null = null
const pluginRuntimes = new Map<string, DashboardPluginRuntime>()
const nativeWebSocket = window.WebSocket
const nativeFetch = window.fetch.bind(window)
const SOCKET_PREFIX = 'hermess-plugin-ws:'
const HTTP_ORIGIN = 'http://hermess-plugin.local'
let socketShimInstalled = false
let fetchShimInstalled = false
const bridgedSockets = new Set<BridgedWebSocket>()

function notify() { for (const listener of listeners) listener() }

export function refreshDashboardPlugins(profile: string, reload = false) {
  for (const listener of refreshListeners) listener(profile, reload)
}

function useDashboardPluginChanges() {
  const [, update] = React.useReducer(value => value + 1, 0)
  React.useLayoutEffect(() => {
    const listener = () => update()
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
}

export function useDashboardPluginDefinitions(profile: string | null) {
  useDashboardPluginChanges()
  if (!profile || registryProfile !== profile || !activeRuntime?.active) return { definitions: [], error: '' }
  return {
    definitions: pluginManifests.map(manifest => dashboardPluginDefinition(
      manifest, pluginAssets.get(manifest.name), registered.has(manifest.name),
      [...registeredSlots].filter(([, entries]) => entries.has(manifest.name)).map(([slot]) => slot),
    )),
    error: pluginDiscoveryError,
  }
}

function bytesFromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function base64FromBytes(bytes: Uint8Array) {
  let binary = ''
  const size = 0x8000
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size))
  }
  return btoa(binary)
}

async function requestBody(init: RequestInit) {
  if (init.body === undefined || init.body === null) return {}
  if (typeof init.body === 'string') {
    const contentType = new Headers(init.headers).get('content-type') || 'text/plain;charset=UTF-8'
    if (contentType.includes('application/json')) return { body: JSON.parse(init.body) as unknown }
  }
  const request = new Request('http://hermess.local/upload', { method: 'POST', headers: init.headers, body: init.body })
  const bytes = new Uint8Array(await request.arrayBuffer())
  return { body_base64: base64FromBytes(bytes), content_type: request.headers.get('content-type') || 'application/octet-stream' }
}

function Card({ children, className = '', ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={`dashboard-sdk-card ${className}`} {...props}>{children}</section>
}
function CardContent({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`dashboard-sdk-card-content ${className}`} {...props}>{children}</div>
}
type DashboardButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  prefix?: React.ReactNode; ghost?: boolean; outlined?: boolean; size?: 'xs' | 'sm' | 'md' | 'icon'
}
function Button({ children, className = '', prefix, ghost, outlined, size = 'md', type = 'button', ...props }: DashboardButtonProps) {
  return <button type={type} className={`dashboard-sdk-button size-${size}${ghost ? ' ghost' : ''}${outlined ? ' outlined' : ''} ${className}`} {...props}>{prefix}{children}</button>
}
function CardHeader({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) { return <header className={`dashboard-sdk-card-header ${className}`} {...props}>{children}</header> }
function CardTitle({ children, className = '', ...props }: React.HTMLAttributes<HTMLHeadingElement>) { return <h3 className={`dashboard-sdk-card-title ${className}`} {...props}>{children}</h3> }
type DashboardBadgeProps = React.HTMLAttributes<HTMLSpanElement> & { tone?: string }
function Badge({ children, className = '', tone = 'outline', ...props }: DashboardBadgeProps) { return <span className={`dashboard-sdk-badge tone-${tone} ${className}`} {...props}>{children}</span> }
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} /> }
function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label {...props} /> }
function Separator({ className = '', ...props }: React.HTMLAttributes<HTMLHRElement>) { return <hr className={`dashboard-sdk-separator ${className}`} {...props} /> }
type DashboardSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { onValueChange?: (value: string) => void }
function Select({ onValueChange, onChange, ...props }: DashboardSelectProps) {
  return <select {...props} onChange={event => { onChange?.(event); onValueChange?.(event.currentTarget.value) }} />
}
function SelectOption(props: React.OptionHTMLAttributes<HTMLOptionElement>) { return <option {...props} /> }
function Checkbox({ checked, onCheckedChange, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { onCheckedChange?: (checked: boolean) => void }) {
  return <input {...props} type="checkbox" checked={checked} onChange={event => { props.onChange?.(event); onCheckedChange?.(event.currentTarget.checked) }} />
}
type DashboardTabsContextValue = { value: string; select(value: string): void }
const DashboardTabsContext = React.createContext<DashboardTabsContextValue | null>(null)
type DashboardTabsProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'defaultValue'> & {
  value?: string; defaultValue?: string; onValueChange?: (value: string) => void
}
function Tabs({ children, value, defaultValue = '', onValueChange, ...props }: DashboardTabsProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const selected = value === undefined ? uncontrolled : value
  const select = React.useCallback((next: string) => {
    if (value === undefined) setUncontrolled(next)
    if (next !== selected) onValueChange?.(next)
  }, [onValueChange, selected, value])
  return <DashboardTabsContext.Provider value={{ value: selected, select }}><div {...props}>{children}</div></DashboardTabsContext.Provider>
}
function TabsList({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div role="tablist" {...props}>{children}</div> }
type DashboardTabsTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
function TabsTrigger({ children, value, onClick, ...props }: DashboardTabsTriggerProps) {
  const tabs = React.useContext(DashboardTabsContext)
  const selected = tabs?.value === value
  return <button type="button" role="tab" aria-selected={selected} data-state={selected ? 'active' : 'inactive'} {...props}
    onClick={event => { onClick?.(event); if (!event.defaultPrevented && !props.disabled) tabs?.select(value) }}>{children}</button>
}

type ConfirmDialogProps = { open: boolean; title: string; description?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; loading?: boolean; onConfirm(): void; onCancel(): void }
function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, loading, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null
  return <div className="dashboard-sdk-dialog-backdrop" role="dialog" aria-modal="true" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}><div className="dashboard-sdk-dialog"><h2>{title}</h2>{description && <p>{description}</p>}<div className="dashboard-sdk-dialog-actions"><Button disabled={loading} onClick={onCancel}>{cancelLabel}</Button><Button className={destructive ? 'destructive' : ''} disabled={loading} onClick={onConfirm}>{loading ? '…' : confirmLabel}</Button></div></div></div>
}

const DialogContext = React.createContext<(() => void) | null>(null)
function Dialog({ open = true, onOpenChange, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: React.ReactNode }) {
  if (!open) return null
  return <DialogContext.Provider value={() => onOpenChange?.(false)}>{children}</DialogContext.Provider>
}
function DialogClose({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const close = React.useContext(DialogContext)
  return <button type="button" {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) close?.() }}>{children}</button>
}
function DialogContent({ children, className = '', onKeyDown, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const close = React.useContext(DialogContext)
  return <div className="dashboard-sdk-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close?.() }}>
    <div role="dialog" aria-modal="true" tabIndex={-1} className={`dashboard-sdk-dialog ${className}`} {...props}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.key === 'Escape') close?.() }}>{children}</div>
  </div>
}
function DialogHeader(props: React.HTMLAttributes<HTMLDivElement>) { return <header {...props} /> }
function DialogFooter(props: React.HTMLAttributes<HTMLDivElement>) { return <footer {...props} /> }
function DialogTitle(props: React.HTMLAttributes<HTMLHeadingElement>) { return <h2 {...props} /> }
function DialogDescription(props: React.HTMLAttributes<HTMLParagraphElement>) { return <p {...props} /> }
function useHostToast() {
  const [toast, setToast] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const showToast = React.useCallback((message: string, type: 'success' | 'error') => setToast({ message, type }), [])
  return { showToast, toast }
}

function useHostConfirmDelete<T>({ onDelete }: { onDelete(id: T): Promise<void> }) {
  const [pendingId, setPendingId] = React.useState<T | null>(null)
  const [isDeleting, setDeleting] = React.useState(false)
  return {
    requestDelete: (id: T) => setPendingId(id),
    confirm: async () => { if (pendingId === null) return; setDeleting(true); try { await onDelete(pendingId); setPendingId(null) } finally { setDeleting(false) } },
    cancel: () => setPendingId(null), isOpen: pendingId !== null, isDeleting, pendingId,
  }
}

function pluginSocketPath(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, 'http://hermess.local')
  if (url.origin !== 'http://hermess.local' || !url.pathname.startsWith('/api/plugins/')) throw new Error('Plugin WebSocket path is outside the allowed boundary')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return `${url.pathname}${url.search}`
}

class BridgedWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  extensions = ''
  protocol = ''
  readyState = BridgedWebSocket.CONNECTING
  url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  private handle: DashboardPluginSocket | null = null
  private closeRequested = false
  private pending: DashboardPluginSocketEvent[] = []
  private readonly runtime: DashboardPluginRuntime | null
  private readonly path: string

  constructor(url: string, runtime: DashboardPluginRuntime | null, path: string) {
    super()
    this.url = url
    this.runtime = runtime
    this.path = path
    bridgedSockets.add(this)
    queueMicrotask(() => void this.connect())
  }

  belongsTo(runtime: DashboardPluginRuntime) { return this.runtime === runtime }

  private emit(event: Event) {
    if (event.type === 'open') this.onopen?.(event)
    else if (event.type === 'message') this.onmessage?.(event as MessageEvent)
    else if (event.type === 'error') this.onerror?.(event)
    else if (event.type === 'close') this.onclose?.(event as CloseEvent)
    this.dispatchEvent(event)
  }

  private receive(event: DashboardPluginSocketEvent) {
    if (!this.handle) { this.pending.push(event); return }
    if (event.kind === 'message') {
      const data = event.binary_base64
        ? (this.binaryType === 'arraybuffer' ? bytesFromBase64(event.binary_base64).buffer : new Blob([bytesFromBase64(event.binary_base64)]))
        : event.data || ''
      this.emit(new MessageEvent('message', { data }))
      return
    }
    if (event.kind === 'closed' && this.readyState !== BridgedWebSocket.CLOSED) {
      this.handle.close()
      this.handle = null
      this.readyState = BridgedWebSocket.CLOSED
      bridgedSockets.delete(this)
      this.emit(new CloseEvent('close', { code: event.reason === 'ended' ? 1000 : 1006, reason: event.reason || '' }))
    }
  }

  private async connect() {
    try {
      if (!this.runtime) throw new Error('Dashboard plugin socket runtime is unavailable')
      const handle = await this.runtime.socket(this.path, event => this.receive(event))
      this.handle = handle
      if (this.closeRequested) {
        handle.close(); this.handle = null; this.readyState = BridgedWebSocket.CLOSED
        bridgedSockets.delete(this)
        this.emit(new CloseEvent('close', { code: 1000, reason: '' }))
        return
      }
      this.readyState = BridgedWebSocket.OPEN
      this.emit(new Event('open'))
      for (const event of this.pending.splice(0)) this.receive(event)
    } catch {
      this.readyState = BridgedWebSocket.CLOSED
      bridgedSockets.delete(this)
      this.emit(new Event('error'))
      this.emit(new CloseEvent('close', { code: 1006, reason: 'connection_failed' }))
    }
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== BridgedWebSocket.OPEN || !this.handle) throw new DOMException('WebSocket is not open', 'InvalidStateError')
    const failed = () => {
      if (this.readyState === BridgedWebSocket.OPEN) this.emit(new Event('error'))
    }
    if (typeof data === 'string') { void this.handle.send(data).catch(failed); return }
    if (data instanceof Blob) {
      void data.arrayBuffer().then(value => this.handle?.send(base64FromBytes(new Uint8Array(value)), true)).catch(failed)
      return
    }
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data)
    void this.handle.send(base64FromBytes(bytes), true).catch(failed)
  }

  close() {
    if (this.readyState === BridgedWebSocket.CLOSED || this.readyState === BridgedWebSocket.CLOSING) return
    this.closeRequested = true
    this.readyState = BridgedWebSocket.CLOSING
    if (this.handle) {
      this.handle.close(); this.handle = null; this.readyState = BridgedWebSocket.CLOSED
      bridgedSockets.delete(this)
      this.emit(new CloseEvent('close', { code: 1000, reason: '' }))
    }
  }
}

function runtimeSocketUrl(runtime: DashboardPluginRuntime, path: string) {
  runtime.assertActive()
  return `${SOCKET_PREFIX}${encodeURIComponent(JSON.stringify({ runtime: runtime.id, path }))}`
}

function runtimeHttpUrl(runtime: DashboardPluginRuntime, path: string) {
  runtime.assertActive()
  const url = new URL(path, HTTP_ORIGIN)
  url.searchParams.set('hermess_proxy', runtime.id)
  return url.toString()
}

function bridgedSocketFromUrl(target: string) {
  try {
    const descriptor = JSON.parse(decodeURIComponent(target.slice(SOCKET_PREFIX.length))) as { runtime?: string; path?: string }
    const runtime = descriptor.runtime ? pluginRuntimes.get(descriptor.runtime) || null : null
    return new BridgedWebSocket(target, runtime, typeof descriptor.path === 'string' ? descriptor.path : '')
  } catch {
    return new BridgedWebSocket(target, null, '')
  }
}

function invalidateRuntime(runtime: DashboardPluginRuntime) {
  runtime.invalidate()
  pluginRuntimes.delete(runtime.id)
  for (const socket of [...bridgedSockets]) if (socket.belongsTo(runtime)) socket.close()
  if (activeRuntime === runtime) activeRuntime = null
}

function installSocketShim() {
  if (socketShimInstalled) return
  const HostWebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const target = String(url)
    if (target.startsWith(SOCKET_PREFIX)) return bridgedSocketFromUrl(target)
    try {
      const parsed = new URL(target)
      const runtimeId = parsed.searchParams.get('hermess_proxy')
      if (runtimeId?.startsWith('dashboard-runtime-') && parsed.pathname.startsWith('/api/plugins/')) {
        parsed.searchParams.delete('hermess_proxy')
        return bridgedSocketFromUrl(`${SOCKET_PREFIX}${encodeURIComponent(JSON.stringify({ runtime: runtimeId, path: `${parsed.pathname}${parsed.search}` }))}`)
      }
    } catch { /* Native WebSocket reports malformed ordinary URLs. */ }
    return new nativeWebSocket(url, protocols)
  } as unknown as typeof WebSocket
  Object.defineProperties(HostWebSocket, {
    CONNECTING: { value: WebSocket.CONNECTING }, OPEN: { value: WebSocket.OPEN },
    CLOSING: { value: WebSocket.CLOSING }, CLOSED: { value: WebSocket.CLOSED },
  })
  HostWebSocket.prototype = nativeWebSocket.prototype
  window.WebSocket = HostWebSocket
  socketShimInstalled = true
}

function installFetchShim() {
  if (fetchShimInstalled) return
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input)
    let url: URL
    try { url = new URL(target) } catch { return nativeFetch(input, init) }
    if (url.origin !== HTTP_ORIGIN) return nativeFetch(input, init)
    const runtimeId = url.searchParams.get('hermess_proxy')
    const runtime = runtimeId ? pluginRuntimes.get(runtimeId) : null
    if (!runtime) throw new Error('Dashboard plugin runtime is no longer active')
    url.searchParams.delete('hermess_proxy')
    const path = `${url.pathname}${url.search}`
    if (!(input instanceof Request)) return runtime.request(path, init)
    const method = init?.method || input.method
    const headers = init?.headers || input.headers
    const body = init?.body ?? (['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : await input.clone().arrayBuffer())
    return runtime.request(path, { ...init, method, headers, body })
  }
  fetchShimInstalled = true
}

function exposeRuntime(runtime: DashboardPluginRuntime, lifecycle: { start(): Promise<unknown>; stop(): Promise<unknown>; restart(): Promise<unknown> }, readHermesVersion: () => Promise<string>) {
  if (activeRuntime && activeRuntime !== runtime) invalidateRuntime(activeRuntime)
  activeRuntime = runtime
  pluginRuntimes.set(runtime.id, runtime)
  const profile = runtime.owner
  const language = runtime.language
  if (registryProfile !== profile) {
    registryProfile = profile
    registered.clear()
    registeredSlots.clear()
    queueMicrotask(notify)
  }
  const fetchJSON = async (path: string, init?: RequestInit) => {
    const response = await runtime.request(path, init)
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status}: ${text}`)
    const value = text ? JSON.parse(text) : null
    return localizeAchievementPayload(path, value, language)
  }
  syncDashboardPluginLanguage(language)
  const useI18n = () => useDashboardPluginI18n(changeLanguage)
  const guardedLifecycle = {
    start: async () => { runtime.assertActive(); return lifecycle.start() },
    stop: async () => { runtime.assertActive(); return lifecycle.stop() },
    restart: async () => { runtime.assertActive(); return lifecycle.restart() },
  }
  const buildWsUrl = async (path: string, params?: Record<string, string>) => runtimeSocketUrl(runtime, pluginSocketPath(path, params))
  const sdk = {
    sdkVersion: '1.1.0', React,
    hooks: {
      useState: React.useState, useEffect: React.useEffect, useCallback: React.useCallback,
      useMemo: React.useMemo, useRef: React.useRef, useContext: React.useContext,
      createContext: React.createContext,
      useToast: useHostToast, useConfirmDelete: useHostConfirmDelete,
    },
    api: createDashboardPluginApi(fetchJSON, runtime.request.bind(runtime), buildWsUrl, profile, guardedLifecycle,
      path => runtimeHttpUrl(runtime, dashboardPluginApiPath(path, profile)), async () => {
        runtime.assertActive()
        return readHermesVersion()
      }), fetchJSON, authedFetch: runtime.request.bind(runtime),
    buildWsUrl,
    buildWsAuthParam: async () => { runtime.assertActive(); return ['hermess_proxy', runtime.id] as [string, string] },
    components: {
      Card, CardHeader, CardTitle, CardContent, Badge, Button, Checkbox, ConfirmDialog,
      Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
      Input, Label, Select, SelectOption, Separator, Tabs, TabsList, TabsTrigger, Toast,
      PluginSlot: DashboardPluginSlot,
    },
    utils: {
      cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
      timeAgo: dashboardTimeAgo,
      isoTimeAgo: dashboardIsoTimeAgo,
    },
    useI18n,
  }
  Object.assign(window as unknown as Record<string, unknown>, {
    __HERMES_PLUGIN_SDK__: sdk,
    __HERMES_PLUGINS__: {
      register(name: string, component: PluginComponent) {
        if (!acceptRegistration(runtime, name) || typeof component !== 'function') return
        registered.set(name, component); notify()
      },
      registerSlot(plugin: string, slot: string, component: React.ComponentType) {
        if (!acceptRegistration(runtime, plugin) || !slot || slot.length > 80 || typeof component !== 'function') return
        const entries = registeredSlots.get(slot) || new Map<string, React.ComponentType>()
        entries.set(plugin, component); registeredSlots.set(slot, entries); notify()
      },
    },
  })
}

function acceptRegistration(runtime: DashboardPluginRuntime, name: string) {
  if (!runtime.active || activeRuntime !== runtime || !pluginAssets.has(name)) return false
  const script = document.currentScript
  if (!(script instanceof HTMLScriptElement) || !script.dataset.hermessDashboardRuntime) return true
  return script.dataset.hermessDashboardRuntime === runtime.id && script.isConnected && script.dataset.hermessDashboardPlugin === name
}

function assetUrl(origin: string, profile: string, plugin: string, file: string) {
  const owner = encodeURIComponent(profile)
  const name = plugin.split('/').map(encodeURIComponent).join('/')
  return `${origin}/dashboard-plugins/@${owner}/${name}/${file}`
}

export function useDashboardPlugins(connected: boolean, profile: string | null, epoch: string | null, language: 'zh-CN' | 'en-US', lifecycle: { start(): Promise<unknown>; stop(): Promise<unknown>; restart(): Promise<unknown> }) {
  const { about, dashboardPlugins, extensions } = useDesktop()
  const lifecycleRef = React.useRef(lifecycle)
  lifecycleRef.current = lifecycle
  const stableLifecycle = React.useMemo(() => ({
    start: () => lifecycleRef.current.start(),
    stop: () => lifecycleRef.current.stop(),
    restart: () => lifecycleRef.current.restart(),
  }), [])
  useDashboardPluginChanges()
  React.useLayoutEffect(() => {
    if (!connected || !profile || !epoch) return
    let active = true
    let generation = 0
    let reloadPending = false
    const entries = new Map<string, { key: string; script: HTMLScriptElement; style?: HTMLLinkElement }>()
    const scope: ProfileScope = { kind: 'profile', profile }
    installSocketShim()
    installFetchShim()
    let runtime: DashboardPluginRuntime
    const request = async (input: string, init: RequestInit = {}) => {
      const method = (init.method || 'GET').toUpperCase()
      const body = await requestBody(init)
      assertDashboardPluginBodyProfile(body.body, profile)
      runtime.assertActive()
      const result = await extensions.request<DashboardPluginResponsePayload>(scope, 'dashboard.plugins.request', { path: dashboardPluginApiPath(input, profile), method, ...body })
      return dashboardPluginResponse(result)
    }
    runtime = new DashboardPluginRuntime(profile, language, request,
      (path, handler) => dashboardPlugins.socket(scope, pluginSocketPath(path), handler))
    exposeRuntime(runtime, stableLifecycle, async () => (await about.productInfo()).hermesVersion)
    const removeEntry = (name: string) => {
      const entry = entries.get(name)
      entry?.script.remove()
      entry?.style?.remove()
      entries.delete(name)
      pluginAssets.delete(name)
      registered.delete(name)
      for (const [slot, components] of registeredSlots) {
        components.delete(name)
        if (!components.size) registeredSlots.delete(slot)
      }
    }
    const loadEntry = (manifest: DashboardPluginManifest, origin: string, operation: number, replace: boolean) => {
      const { name, entry, css, integrity } = manifest
      const script = document.createElement('script')
      const style = css ? document.createElement('link') : undefined
      const assets: DashboardPluginAssets = { script: 'loading', styleFailed: false }
      pluginAssets.set(name, assets)
      entries.set(name, { key: dashboardPluginEntryKey(manifest), script, style })
      const current = () => active && entries.get(name)?.script === script
      const log = { runtime: runtime.id, operation, profile, plugin: name }
      const asset = (file: string) => {
        const url = assetUrl(origin, profile, name, file)
        return replace ? `${url}?hermess-reload=${runtime.id}-${operation}` : url
      }
      script.src = asset(entry)
      script.async = true
      script.dataset.hermessDashboardRuntime = runtime.id
      script.dataset.hermessDashboardPlugin = name
      if (integrity) { script.integrity = integrity; script.crossOrigin = 'anonymous' }
      script.onload = () => {
        if (!current()) return
        assets.script = 'loaded'
        const hasContribution = registered.has(name) || [...registeredSlots.values()].some(slot => slot.has(name))
        console.info('[dashboard-plugin] entry loaded', { ...log, registered: hasContribution })
        notify()
      }
      script.onerror = () => {
        if (!current()) return
        assets.script = 'failed'
        console.error('[dashboard-plugin] entry failed', log)
        notify()
      }
      if (style && css) {
        style.rel = 'stylesheet'
        style.href = asset(css)
        style.onerror = () => {
          if (!current()) return
          assets.styleFailed = true
          console.error('[dashboard-plugin] stylesheet failed', log)
          notify()
        }
        document.head.appendChild(style)
      }
      document.body.appendChild(script)
    }
    const refresh = async (reload = false) => {
      reloadPending ||= reload
      const operation = ++generation
      const log = { runtime: runtime.id, operation, profile }
      console.info('[dashboard-plugin] discovery started', log)
      try {
        const result = await extensions.request<{ plugins: DashboardPluginManifest[]; asset_origin: string }>(scope, 'dashboard.plugins.list')
        if (!active || operation !== generation) return
        const loadable = result.plugins.filter(manifest => manifest.name !== 'kanban').map(manifest => ({
          ...manifest,
          label: localizeDashboardPluginLabel(manifest.name, manifest.label, language),
        }))
        const next = new Map(loadable.map(manifest => [manifest.name, manifest]))
        const replaced = new Set<string>()
        for (const [name, previous] of entries) {
          const manifest = next.get(name)
          if (manifest && !reloadPending && previous.key === dashboardPluginEntryKey(manifest)) continue
          if (manifest) replaced.add(name)
          removeEntry(name)
        }
        pluginManifests = loadable
        pluginDiscoveryError = ''
        for (const manifest of loadable) {
          if (!entries.has(manifest.name)) loadEntry(manifest, result.asset_origin, operation, reloadPending || replaced.has(manifest.name))
        }
        reloadPending = false
        console.info('[dashboard-plugin] discovery finished', { ...log, count: loadable.length })
      } catch {
        if (!active || operation !== generation) return
        for (const name of entries.keys()) removeEntry(name)
        pluginManifests = []
        pluginDiscoveryError = language === 'zh-CN' ? '无法读取 Dashboard 界面插件。请重新扫描。' : 'Could not read Dashboard extensions. Rescan to retry.'
        console.error('[dashboard-plugin] discovery failed', log)
      }
      notify()
    }
    const refreshCurrent = (owner: string, reload: boolean) => { if (owner === profile) void refresh(reload) }
    refreshListeners.add(refreshCurrent)
    void refresh()
    return () => {
      active = false
      refreshListeners.delete(refreshCurrent)
      for (const name of entries.keys()) removeEntry(name)
      if (activeRuntime === runtime) {
        pluginManifests = []
        pluginDiscoveryError = ''
        registered.clear()
        registeredSlots.clear()
      }
      invalidateRuntime(runtime)
      notify()
    }
  }, [about, connected, dashboardPlugins, epoch, extensions, language, profile, stableLifecycle])
  const current = connected && registryProfile === profile && activeRuntime?.active
  return { manifests: current ? pluginManifests : [], components: current ? registered : new Map<string, PluginComponent>(), error: current ? pluginDiscoveryError : '' }
}

export function DashboardPluginPage({ manifest, component: Component, error, onBack }: { manifest: DashboardPluginManifest | null; component?: PluginComponent; error?: string; onBack?: () => void }) {
  const zh = useLanguage() === 'zh-CN'
  const script = manifest ? pluginAssets.get(manifest.name)?.script : undefined
  const status = !manifest ? (zh ? '插件不存在或已被当前 Profile 隐藏。' : 'The plugin is unavailable or hidden for this Profile.')
    : script === 'failed' ? (zh ? '插件入口脚本加载失败。' : 'The plugin entry script could not load.')
      : script === 'loaded' ? (zh ? '入口脚本已加载，页面组件尚未注册。' : 'Entry script loaded. No page component is registered yet.')
        : (zh ? '正在加载插件界面…' : 'Loading plugin interface…')
  const content = manifest && Component ? <section className="dashboard-plugin-page" data-plugin={manifest.name}><Component /></section>
    : <section className="dashboard-plugin-state"><h1>{manifest?.label || 'Dashboard Plugin'}</h1><p>{error || status}</p></section>
  if (!onBack) return content
  return <div className="dashboard-plugin-view">
    <header className="dashboard-plugin-navigation">
      <button type="button" onClick={onBack}><span aria-hidden="true">← </span>{zh ? '返回' : 'Back'}</button>
      <span>{zh ? 'Dashboard 插件' : 'Dashboard plugin'}</span>
      {manifest && <strong title={manifest.label}>{manifest.label}</strong>}
    </header>
    {content}
  </div>
}

export function DashboardPluginSlot({ name, fallback }: { name: string; fallback?: React.ReactNode }) {
  useDashboardPluginChanges()
  const entries = [...(registeredSlots.get(name)?.entries() || [])]
  if (!entries.length) return <>{fallback ?? null}</>
  return <>{entries.map(([plugin, Component]) => <Component key={plugin} />)}</>
}
