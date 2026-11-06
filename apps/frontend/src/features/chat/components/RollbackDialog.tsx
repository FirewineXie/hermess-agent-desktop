import type { RollbackController, RollbackRestoreMode } from '../useRollbackController'
import '../rollback.css'

function label(mode: RollbackRestoreMode, zh: boolean) {
  if (mode === 'file') return zh ? '恢复这个文件' : 'Restore this file'
  if (mode === 'all') return zh ? '覆盖手动编辑并完整恢复' : 'Restore everything, including manual edits'
  return zh ? '恢复工作区并保留手动编辑' : 'Restore workspace and keep manual edits'
}

export default function RollbackDialog({ controller, language }: { controller: RollbackController; language: 'zh-CN' | 'en-US' }) {
  if (!controller.open) return null
  const zh = language === 'zh-CN'
  const selectedHash = controller.selected?.hash
  return <div className="rollback-overlay" role="presentation">
    <section className="rollback-dialog" role="dialog" aria-modal="true" aria-label={zh ? '文件回滚' : 'File rollback'}>
      <header><div><span>HERMESS · ROLLBACK</span><h2>{zh ? '恢复文件检查点' : 'Restore a checkpoint'}</h2><p>{zh ? '先查看差异，再恢复单个文件或整个工作区。' : 'Review the diff, then restore one file or the workspace.'}</p></div><button type="button" aria-label={zh ? '关闭' : 'Close'} disabled={controller.busy} onClick={controller.close}>×</button></header>
      {controller.error && <p className="rollback-error" role="alert">{controller.error}</p>}
      {controller.notice && <p className="rollback-notice" role="status">{controller.notice}</p>}
      {controller.restoreResult && <div className="rollback-result"><strong>{zh ? '恢复结果' : 'Restore result'}</strong>{[
        [zh ? '已恢复' : 'Restored', controller.restoreResult.restored_files],
        [zh ? '保留手动编辑' : 'Kept manual edits', controller.restoreResult.skipped_user_edits],
        [zh ? '跳过超大文件' : 'Skipped oversized files', controller.restoreResult.skipped_oversize],
        [zh ? '删除失败' : 'Failed deletes', controller.restoreResult.failed_deletes],
      ].filter(([, rows]) => rows?.length).map(([title, rows]) => <p key={String(title)}><b>{title}：</b>{(rows as string[]).join('、')}</p>)}</div>}
      {!controller.enabled && <div className="rollback-empty"><strong>{zh ? '当前会话未启用检查点' : 'Checkpoints are disabled for this session'}</strong><p>{zh ? '启用检查点后，Hermes 才会在写文件前保存可恢复状态。' : 'Enable checkpoints so Hermes saves recoverable state before file writes.'}</p></div>}
      {controller.enabled && <div className="rollback-layout">
        <aside><div className="rollback-list-title"><strong>{zh ? '检查点' : 'Checkpoints'}</strong><button type="button" disabled={controller.busy} onClick={() => void controller.load()}>{zh ? '刷新' : 'Refresh'}</button></div>
          {!controller.checkpoints.length && !controller.busy && <p>{zh ? '还没有检查点。' : 'No checkpoints yet.'}</p>}
          {controller.checkpoints.map((row, index) => <button type="button" className={selectedHash === row.hash ? 'active' : ''} disabled={controller.busy} key={row.hash} onClick={() => void controller.inspect(row)}><b>{index + 1}</b><span><strong>{row.hash.slice(0, 8)}</strong><small>{row.timestamp || (zh ? '时间未知' : 'Unknown time')}</small><em>{row.message || (zh ? '文件操作前' : 'Before file operation')}</em></span></button>)}
        </aside>
        <main>{!controller.selected ? <div className="rollback-empty"><strong>{zh ? '选择一个检查点' : 'Select a checkpoint'}</strong><p>{zh ? '右侧会显示它与当前工作区的差异。' : 'Its changes against the current workspace will appear here.'}</p></div> : <>
          <div className="rollback-diff-head"><div><strong>{controller.selected.hash.slice(0, 12)}</strong><span>{controller.selected.message}</span></div><span>{controller.busy ? (zh ? '读取中…' : 'Loading…') : (zh ? '差异预览' : 'Diff preview')}</span></div>
          <pre className="rollback-diff">{[controller.diff?.stat, controller.diff?.diff].filter(Boolean).join('\n\n') || (controller.busy ? '' : (zh ? '当前工作区与此检查点没有可显示的差异。' : 'No visible difference from this checkpoint.'))}</pre>
          <div className="rollback-file"><label>{zh ? '仅恢复一个文件（相对工作区路径）' : 'Restore one file (workspace-relative path)'}<input value={controller.filePath} disabled={controller.busy} placeholder="src/example.ts" onChange={event => controller.setFilePath(event.target.value)} /></label><button type="button" disabled={controller.busy || !controller.filePath.trim()} onClick={() => controller.requestRestore('file')}>{zh ? '恢复文件' : 'Restore file'}</button></div>
          <div className="rollback-actions"><button type="button" disabled={controller.busy} onClick={() => controller.requestRestore('safe')}>{zh ? '恢复工作区' : 'Restore workspace'}</button><button type="button" className="danger" disabled={controller.busy} onClick={() => controller.requestRestore('all')}>{zh ? '覆盖手动编辑' : 'Overwrite manual edits'}</button></div>
        </>}</main>
      </div>}
      {controller.pendingMode && <div className="rollback-confirm" role="alertdialog" aria-modal="true"><div><h3>{zh ? '确认恢复？' : 'Confirm restore?'}</h3><p>{controller.pendingMode === 'file' ? (zh ? `将把 ${controller.filePath.trim()} 恢复到所选检查点。` : `Restore ${controller.filePath.trim()} to the selected checkpoint.`) : controller.pendingMode === 'all' ? (zh ? '这会完整恢复工作区，并覆盖检查点之后的手动编辑，同时回退最后一轮会话。' : 'This restores the entire workspace, overwrites manual edits, and rewinds the latest turn.') : (zh ? '这会恢复整个工作区，但保留检查点之后的手动编辑，同时回退最后一轮会话。' : 'This restores the workspace while keeping manual edits, and rewinds the latest turn.')}</p><div><button type="button" className={controller.pendingMode === 'all' ? 'danger' : ''} disabled={controller.busy} onClick={() => void controller.restore()}>{label(controller.pendingMode, zh)}</button><button type="button" disabled={controller.busy} onClick={controller.cancelRestore}>{zh ? '取消' : 'Cancel'}</button></div></div></div>}
    </section>
  </div>
}
