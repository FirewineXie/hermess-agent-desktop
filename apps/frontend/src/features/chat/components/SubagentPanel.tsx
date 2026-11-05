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
  const active = controller.roster?.subagents || []
  const rows = [...active, ...controller.finished.filter(row => !active.some(item => item.subagent_id === row.subagent_id))]
  const selected = rows.find(row => row.subagent_id === controller.selectedId)
  return <section className="subagent-panel" aria-label={zh ? '子代理任务' : 'Subagent tasks'}>
    <button type="button" className="subagent-header" aria-expanded={controller.expanded} onClick={() => controller.setExpanded(value => !value)}>
      <strong>{zh ? '子代理任务' : 'Subagents'}</strong><span>{controller.loading && !controller.roster ? (zh ? '读取中…' : 'Loading…') : rows.length}</span><span>{controller.expanded ? '⌃' : '⌄'}</span>
    </button>
    {controller.expanded && <div className="subagent-body">
      {controller.error && <p role="alert" className="subagent-error">{controller.error}</p>}
      {!rows.length && !controller.error && <p>{zh ? '当前会话没有子代理任务。' : 'No subagent tasks in this session.'}</p>}
      {!!rows.length && <div className="subagent-roster">{rows.map(row => <button type="button" key={row.subagent_id} className={controller.selectedId === row.subagent_id ? 'selected' : ''} onClick={() => controller.select(row.subagent_id)}>
        <strong>{row.goal || row.subagent_id}</strong><span>{row.status || (zh ? '状态未知' : 'Unknown')} · {row.last_tool || (zh ? '暂无活动' : 'No activity yet')}</span>
      </button>)}</div>}
      {selected && <div className="subagent-detail">
        <div><strong>{selected.goal || selected.subagent_id}</strong><small>{selected.model || ''}</small></div>
        <p>{zh ? '状态' : 'Status'}：{selected.status || '—'} · {zh ? '工具调用' : 'Tools'}：{selected.tool_count ?? 0}</p>
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
