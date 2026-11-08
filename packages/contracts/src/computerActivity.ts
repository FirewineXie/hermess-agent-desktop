/** Shared by the isolated desktop banner and its native owner. No tool inputs are exposed. */
export type ComputerActivityStatus = {
  phase: 'idle' | 'active' | 'stopping' | 'unknown'
  revision: number
  shortcut: string | null
  shortcutUnavailable: boolean
}

export interface ComputerActivityApi {
  read(): Promise<ComputerActivityStatus>
  stop(): Promise<void>
  onChange(handler: (status: ComputerActivityStatus) => void): Promise<() => void>
}
