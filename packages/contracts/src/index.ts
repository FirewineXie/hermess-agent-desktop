export type Unsubscribe = () => void

export type DesktopEvent<T> = { payload: T }

export type NativeDropEvent =
  | { type: 'drop'; paths: string[] }
  | { type: 'enter' | 'over' | 'leave' }

export type NativeOpenOptions = {
  directory: boolean
  multiple: boolean
  title: string
}

/** The host capability boundary. Domain methods replace the transitional invoke API as modules migrate. */
export interface DesktopApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (event: DesktopEvent<T>) => void): Promise<Unsubscribe>
  open(options: NativeOpenOptions): Promise<string | string[] | null>
  onDragDropEvent(handler: (event: DesktopEvent<NativeDropEvent>) => void): Promise<Unsubscribe>
}
