import { useRef } from 'react'
import { useSubagents } from '../useSubagents'
import '../subagents.css'

type Controller = ReturnType<typeof useSubagents>

export function SubagentPanelForSession({ profile, sessionId, active, language }: {
  profile: string; sessionId: string; active: boolean; language: 'zh-CN' | 'en-US'
}) {
  const controller = useSubagents(profile, sessionId, active, language)
  return <SubagentPanel controller={controller} language={language} />
}

export default function SubagentPanel({ controller, language }: { controller: Controller; language: 'zh-CN' | 'en-US' }) {
  const zh = language === 'zh-CN'
  const headerRef = useRef<HTMLButtonElement>(null)
  const close = () => { controller.setExpanded(false); headerRef.current?.focus() }
  const active = controller.roster?.subagents || []
  const rows = [...active, ...controller.finished.filter(row => !active.some(item => item.subagent_id === row.subagent_id))]
  const selected = rows.find(row => row.subagent_id === controller.selectedId)
  const running = rows.filter(row => row.status === 'running').length
  const statuses: Record<string, string> = { running: zh ? '运行中' : 'Running', completed: zh ? '已完成' : 'Completed', finished: zh ? '已结束' : 'Finished', failed: zh ? '失败' : 'Failed', stopped: zh ? '已停止' : 'Stopped' }
  const status = (value: string | null | undefined) => statuses[value || ''] || value || (zh ? '状态未知' : 'Unknown')
  const summary = controller.error ? (zh ? '读取失败' : 'Read failed')
    : controller.loading && !controller.roster ? (zh ? '读取中…' : 'Loading…')
      : `${rows.length}${running ? (zh ? ` · ${running} 运行中` : ` · ${running} running`) : ''}`
  // Background polling must not mount an empty panel for each loading transition.
  if (!rows.length && !controller.error) return null
  return <section className="subagent-panel" aria-label={zh ? '子代理任务' : 'Subagent tasks'} onKeyDown={event => {
    if (event.key === 'Escape' && controller.expanded) { event.stopPropagation(); close() }
  }}>
    <button ref={headerRef} type="button" className="subagent-header" aria-expanded={controller.expanded} onClick={() => controller.setExpanded(value => !value)}>
      <strong>{zh ? '子任务' : 'Subagents'}</strong><span>{summary}</span><span>{controller.expanded ? '⌃' : '⌄'}</span>
    </button>
    {controller.expanded && <div className="subagent-body">
      <button type="button" onClick={close}>{zh ? '关闭面板内容' : 'Close panel content'}</button>
      {controller.error && <p role="alert" className="subagent-error">{controller.error}</p>}
      {!rows.length && !controller.error && <p>{zh ? '当前会话没有子代理任务。' : 'No subagent tasks in this session.'}</p>}
      {!!rows.length && <div className="subagent-roster">{rows.map(row => <button type="button" key={row.subagent_id} aria-expanded={controller.selectedId === row.subagent_id} className={controller.selectedId === row.subagent_id ? 'selected' : ''} onClick={() => controller.select(controller.selectedId === row.subagent_id ? '' : row.subagent_id)}>
        <strong>{row.goal || row.subagent_id}</strong><span>{status(row.status)} · {controller.liveActivity[row.subagent_id] || row.last_tool || (zh ? '暂无活动' : 'No activity yet')}</span>
      </button>)}</div>}
      {selected && <div className="subagent-detail">
        <div><strong>{selected.goal || selected.subagent_id}</strong><small>{selected.model || ''}</small></div>
        <button type="button" onClick={() => controller.select('')}>{zh ? '关闭详情' : 'Close details'}</button>
        <p>{zh ? '状态' : 'Status'}：{status(selected.status)} · {zh ? '工具调用' : 'Tools'}：{selected.tool_count ?? 0}</p>
        {controller.tail?.available ? <pre>{controller.tail.text || (zh ? '暂无输出' : 'No output yet')}{controller.tail.truncated ? '\n…' : ''}</pre>
          : <p>{zh ? '暂无可读取的活动记录。' : 'No activity log available.'}</p>}
        {controller.notice && <p role="status">{controller.notice}</p>}
        {selected.status === 'running' && <div className="subagent-controls">
          <label>{zh ? '给子代理引导' : 'Guide subagent'}<textarea value={controller.guidance} maxLength={4096} onChange={event => controller.setGuidance(event.target.value)} /></label>
          <button type="button" disabled={controller.busy || !selected.accepting_steer || !controller.guidance.trim()} onClick={() => void controller.steer()}>{zh ? '发送引导' : 'Send guidance'}</button>
          <button type="button" disabled={controller.busy} onClick={() => void controller.stop()}>{zh ? '停止子代理' : 'Stop subagent'}</button>
        </div>}
      </div>}
    </div>}
  </section>
}
