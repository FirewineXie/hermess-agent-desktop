import type { DashboardPluginSocket, DashboardPluginSocketEvent } from '@hermess/contracts'

type RuntimeRequest = (path: string, init?: RequestInit) => Promise<Response>
type RuntimeSocket = (path: string, handler: (event: DashboardPluginSocketEvent) => void) => Promise<DashboardPluginSocket>

export class DashboardPluginRuntime {
  readonly id = `dashboard-runtime-${crypto.randomUUID()}`
  readonly owner: string
  readonly language: 'zh-CN' | 'en-US'
  private valid = true
  private readonly requestImpl: RuntimeRequest
  private readonly socketImpl: RuntimeSocket

  constructor(
    owner: string,
    language: 'zh-CN' | 'en-US',
    requestImpl: RuntimeRequest,
    socketImpl: RuntimeSocket,
  ) {
    this.owner = owner
    this.language = language
    this.requestImpl = requestImpl
    this.socketImpl = socketImpl
  }

  get active() { return this.valid }

  assertActive() {
    if (!this.valid) throw new Error(`Dashboard plugin runtime for Profile ${this.owner} is no longer active`)
  }

  async request(path: string, init?: RequestInit) {
    this.assertActive()
    return this.requestImpl(path, init)
  }

  async socket(path: string, handler: (event: DashboardPluginSocketEvent) => void) {
    this.assertActive()
    return this.socketImpl(path, handler)
  }

  invalidate() { this.valid = false }
}
