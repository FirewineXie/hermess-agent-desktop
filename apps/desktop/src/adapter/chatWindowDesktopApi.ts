import type { DesktopApi } from '@hermess/contracts'
import { tauriDesktopApi } from './tauriDesktopApi'

const mainWindowOnly = async (): Promise<never> => {
  throw new Error('Runtime lifecycle is owned by the main window')
}

export const chatWindowDesktopApi: DesktopApi = {
  ...tauriDesktopApi,
  runtime: {
    ...tauriDesktopApi.runtime,
    startDev: mainWindowOnly,
    startPacked: mainWindowOnly,
    reconnect: mainWindowOnly,
    restartGracefully: mainWindowOnly,
    stop: mainWindowOnly,
  },
}
