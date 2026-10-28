import React from 'react'
import type { CheckpointInventory as Inventory } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

export default function CheckpointInventory({ profile, connected, epoch }: { profile: string | null; connected: boolean; epoch: string | null }) {
  const { agentSettings } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [inventory, setInventory] = React.useState<Inventory | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const generation = React.useRef(0)

  const load = React.useCallback(async () => {
    const request = ++generation.current
    setInventory(null)
    setError('')
    setLoading(false)
    if (!connected || !profile) return
    setLoading(true)
    try {
      const result = await agentSettings.checkpoints({ kind: 'profile', profile })
      if (request === generation.current) setInventory(result)
    } catch (cause) {
      if (request === generation.current) setError(describeError(cause, language))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [agentSettings, connected, profile, language])

  React.useEffect(() => {
    void load()
    return () => { generation.current += 1 }
  }, [load, epoch])

  const bytes = inventory ? new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(inventory.total_bytes / 1024 / 1024) : '0'
  return <section className="notification-settings" aria-label={zh ? '检查点存储状态' : 'Checkpoint storage status'}>
    <h2>{zh ? '已保存的检查点' : 'Saved checkpoints'}</h2>
    <p>{zh ? '状态由当前 Profile 的 Gateway 读取；工具修改文件后可刷新，确认是否产生检查点。' : 'Read from the current Profile Gateway. Refresh after a file-changing tool call to check whether a checkpoint was created.'}</p>
    <div className="actions"><button type="button" disabled={!connected || !profile || loading} onClick={() => void load()}>{zh ? '刷新检查点' : 'Refresh checkpoints'}</button></div>
    {loading && <p role="status">{zh ? '正在读取…' : 'Loading…'}</p>}
    {error && <p role="alert">{error}</p>}
    {inventory && <p role="status">{inventory.preview_only ? 'PREVIEW_ONLY · ' : ''}{zh ? `${inventory.sessions.length} 个会话，${bytes} MiB` : `${inventory.sessions.length} sessions, ${bytes} MiB`}</p>}
  </section>
}
