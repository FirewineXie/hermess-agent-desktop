import React from 'react'
import type { CheckpointInventory as Inventory } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'

type PruneStatus = { id: string; running: boolean; exit_code: number | null; error: string | null; lines: string[] }

export default function CheckpointInventory({ profile, language }: { profile: string; language: Language }) {
  const { security, extensions } = useDesktop()
  const zh = language === 'zh-CN'
  const [inventory, setInventory] = React.useState<Inventory | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const [prune, setPrune] = React.useState<PruneStatus | null>(null)
  const [pruneBusy, setPruneBusy] = React.useState(false)
  const [revision, refreshPrune] = React.useReducer(value => value + 1, 0)
  const generation = React.useRef(0)
  const runningId = React.useRef<string | null>(null)

  const read = async () => {
    const current = ++generation.current
    setBusy(true); setError(''); setInventory(null)
    try {
      const value = await security.checkpoints({ kind: 'profile', profile })
      if (current === generation.current) setInventory(value)
    } catch (cause) {
      if (current === generation.current) setError(describeError(cause, language))
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  React.useEffect(() => { void read(); return () => { ++generation.current } }, [profile])
  React.useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const value = await extensions.request<PruneStatus | null>({ kind: 'profile', profile }, 'systemActions.status', { profile, action: 'checkpoints-prune' })
        if (!active) return
        if (value && !value.running && runningId.current === value.id) void read()
        runningId.current = value?.running ? value.id : null
        setPrune(value)
        if (value?.running) timer = setTimeout(() => void load(), 1200)
      } catch (cause) {
        if (active) setError(describeError(cause, language))
      }
    }
    void load()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [profile, extensions, language, revision])

  const startPrune = async () => {
    setConfirm(false); setPruneBusy(true); setError('')
    try {
      const value = await extensions.request<PruneStatus>({ kind: 'profile', profile }, 'systemActions.start',
        { profile, action: 'checkpoints-prune', confirmed: true })
      runningId.current = value.running ? value.id : null
      setPrune(value)
      refreshPrune()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setPruneBusy(false) }
  }
  const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`

  return <section className="configuration-subsection">
    <div className="row"><h3>{zh ? '检查点存储清单' : 'Checkpoint storage'}</h3>
      <button disabled={busy} onClick={() => void read()}>{zh ? '刷新清单' : 'Refresh'}</button></div>
    <p>{zh ? '查看当前 Profile 的检查点目录和占用。清理会按 Hermes 默认规则移除过期或孤立的回滚记录。' : 'View checkpoint directories and size for this Profile. Pruning removes expired or orphaned rollback records using Hermes defaults.'}</p>
    {error && <p role="alert">{error}</p>}
    {!inventory ? <p>{zh ? '正在读取清单…' : 'Loading inventory…'}</p> : <>
      <p>{zh ? '会话目录' : 'Session directories'}：{inventory.sessions.length} · {zh ? '总占用' : 'Total'}：{bytes(inventory.total_bytes)}</p>
      {!inventory.sessions.length ? <p>{zh ? '当前 Profile 没有已保存的检查点目录。' : 'No saved checkpoint directories for this Profile.'}</p>
        : <div className="configuration-inventory">{inventory.sessions.map(item => <div key={item.session}><code>{item.session}</code><span>{item.files} {zh ? '个文件' : 'files'}</span><span>{bytes(item.bytes)}</span></div>)}</div>}
      <button type="button" disabled={busy || pruneBusy || !!prune?.running || !inventory.sessions.length} onClick={() => setConfirm(true)}>{zh ? '清理检查点' : 'Prune checkpoints'}</button>
    </>}
    {prune && <div className="configuration-prune-result"><p role="status">{prune.running ? (zh ? '正在清理…' : 'Pruning…')
      : prune.error ? (zh ? '清理失败' : 'Prune failed') : prune.exit_code === 0 ? (zh ? '清理完成，清单已刷新' : 'Prune complete; inventory refreshed')
        : (zh ? `清理退出码：${prune.exit_code ?? '未知'}` : `Prune exit code: ${prune.exit_code ?? 'unknown'}`)}</p>
      {prune.error && <p role="alert">{prune.error}</p>}
      <pre aria-label={zh ? '清理日志' : 'Prune output'}>{prune.lines.join('\n')}</pre></div>}
    {confirm && <div className="configuration-prune-confirm" role="dialog" aria-modal="true" aria-label={zh ? '确认清理检查点' : 'Confirm checkpoint prune'}>
      <h4>{zh ? '确认清理检查点？' : 'Prune checkpoints?'}</h4>
      <p>{zh ? 'Hermes 会删除超过默认保留期的记录、孤立项目以及超出容量上限的旧提交。已删除的 /rollback 点无法恢复。' : 'Hermes will remove expired records, orphaned projects, and older commits above its size limit. Deleted /rollback points cannot be restored.'}</p>
      <div className="actions"><button type="button" autoFocus onClick={() => setConfirm(false)}>{zh ? '取消' : 'Cancel'}</button>
        <button type="button" onClick={() => void startPrune()}>{zh ? '确认清理' : 'Confirm prune'}</button></div>
    </div>}
  </section>
}
