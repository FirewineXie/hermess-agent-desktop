import React from 'react'
import type { RollbackCheckpoint, RollbackDiffResult, RollbackRestoreResult, SessionScope } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'

export type RollbackRestoreMode = 'file' | 'safe' | 'all'

export function useRollbackController(scope: SessionScope | null, language: 'zh-CN' | 'en-US', refreshRewoundHistory: () => Promise<boolean>) {
  const { chat } = useDesktop()
  const [open, setOpen] = React.useState(false)
  const [enabled, setEnabled] = React.useState(true)
  const [checkpoints, setCheckpoints] = React.useState<RollbackCheckpoint[]>([])
  const [selected, setSelected] = React.useState<RollbackCheckpoint | null>(null)
  const [diff, setDiff] = React.useState<RollbackDiffResult | null>(null)
  const [filePath, setFilePath] = React.useState('')
  const [pendingMode, setPendingMode] = React.useState<RollbackRestoreMode | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [restoreResult, setRestoreResult] = React.useState<RollbackRestoreResult | null>(null)
  const revision = React.useRef(0)
  const scopeKey = scope ? `${scope.profile}\0${scope.sessionId}` : ''

  React.useEffect(() => {
    revision.current++
    setOpen(false); setSelected(null); setDiff(null); setPendingMode(null); setError(''); setNotice(''); setRestoreResult(null)
  }, [scopeKey])

  const load = async (keepSelection = false) => {
    if (!scope) return false
    const current = ++revision.current
    setBusy(true); setError('')
    try {
      const result = await chat.rollbackList(scope)
      if (current !== revision.current) return false
      setEnabled(result.enabled); setCheckpoints(result.checkpoints)
      if (!keepSelection || !result.checkpoints.some(row => row.hash === selected?.hash)) { setSelected(null); setDiff(null) }
      return true
    } catch (cause) {
      if (current === revision.current) setError(describeError(cause, language))
      return false
    } finally { if (current === revision.current) setBusy(false) }
  }

  const show = async () => {
    if (!scope) { setError(language === 'zh-CN' ? '当前没有可回滚的会话。' : 'There is no session to roll back.'); return false }
    setOpen(true); setNotice(''); setFilePath(''); setPendingMode(null); setRestoreResult(null)
    return load()
  }
  const close = () => { if (!busy) { revision.current++; setOpen(false); setPendingMode(null) } }
  const inspect = async (checkpoint: RollbackCheckpoint) => {
    if (!scope || busy) return
    const current = ++revision.current
    setSelected(checkpoint); setDiff(null); setBusy(true); setError(''); setNotice(''); setRestoreResult(null)
    try {
      const result = await chat.rollbackDiff(scope, checkpoint.hash)
      if (current === revision.current) setDiff(result)
    } catch (cause) { if (current === revision.current) setError(describeError(cause, language)) }
    finally { if (current === revision.current) setBusy(false) }
  }
  const requestRestore = (mode: RollbackRestoreMode) => {
    if (!selected || busy) return
    if (mode === 'file' && !filePath.trim()) {
      setError(language === 'zh-CN' ? '请输入要恢复的相对文件路径。' : 'Enter the relative file path to restore.')
      return
    }
    setError(''); setNotice(''); setPendingMode(mode)
  }
  const cancelRestore = () => { if (!busy) setPendingMode(null) }
  const restore = async () => {
    if (!scope || !selected || !pendingMode || busy) return
    const mode = pendingMode
    const current = ++revision.current
    setBusy(true); setError(''); setNotice('')
    try {
      const result: RollbackRestoreResult = await chat.rollbackRestore(scope, {
        hash: selected.hash,
        filePath: mode === 'file' ? filePath.trim() : undefined,
        all: mode === 'all' ? true : undefined,
      })
      if (current !== revision.current) return
      if (!result.success) throw new Error(result.error || (language === 'zh-CN' ? 'Gateway 拒绝恢复。' : 'The Gateway rejected the restore.'))
      setRestoreResult(result)
      let message = language === 'zh-CN' ? `已恢复到 ${result.restored_to || selected.hash.slice(0, 8)}。` : `Restored to ${result.restored_to || selected.hash.slice(0, 8)}.`
      const skipped = [...(result.skipped_user_edits || []), ...(result.skipped_oversize || []), ...(result.failed_deletes || [])]
      if (skipped.length) message += language === 'zh-CN' ? ` ${skipped.length} 项未覆盖，请查看结果。` : ` ${skipped.length} items were not overwritten; review the result.`
      if (mode !== 'file' && result.history_removed) {
        const refreshed = await refreshRewoundHistory()
        if (!refreshed) message += language === 'zh-CN' ? ' 会话历史已回退，但界面刷新失败，请重新打开会话。' : ' History was rewound, but refresh failed. Reopen the session.'
      }
      if (current !== revision.current) return
      setNotice(message); setPendingMode(null)
      await load(true)
    } catch (cause) {
      if (current === revision.current) setError(describeError(cause, language))
    } finally { if (current === revision.current) setBusy(false) }
  }

  return { open, enabled, checkpoints, selected, diff, filePath, setFilePath, pendingMode, busy, error, notice, restoreResult, show, close, load, inspect, requestRestore, cancelRestore, restore }
}

export type RollbackController = ReturnType<typeof useRollbackController>
