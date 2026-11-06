import React from 'react'
import type { BotGroup } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'

export function useGroupRooms(connected: boolean, epoch: string | null, language: 'zh-CN' | 'en-US') {
  const { bots } = useDesktop()
  const [rooms, setRooms] = React.useState<BotGroup[]>([])
  const [error, setError] = React.useState('')
  const requestVersion = React.useRef(0)
  const refresh = React.useCallback(async () => {
    if (!connected) return
    const version = ++requestVersion.current
    try {
      const result = await bots.groups<{ rooms: BotGroup[] }>('default', 'list', {})
      if (version !== requestVersion.current) return
      setRooms(result.rooms.filter(room => room.disbanded_at == null))
      setError('')
    } catch (cause) { if (version === requestVersion.current) setError(describeError(cause, language)) }
  }, [bots, connected, language])
  React.useEffect(() => {
    if (!connected) { ++requestVersion.current; setRooms([]); setError(''); return }
    void refresh()
  }, [connected, epoch, refresh])
  return { rooms, error, refresh }
}
