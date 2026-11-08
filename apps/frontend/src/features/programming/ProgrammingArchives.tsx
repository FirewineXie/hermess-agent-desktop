import React from 'react'
import type { CodingSession } from '@hermess/contracts'
import MarkdownMessage from '../chat/components/MarkdownMessage'
import ProgrammingTimeline from './ProgrammingTool'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import './programming.css'

export default function ProgrammingArchives({ controller, language }: { controller: ProgrammingController; language: Language }) {
  const zh = language === 'zh-CN'
  const [query, setQuery] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [selected, setSelected] = React.useState<CodingSession | null>(null)
  const rows = controller.sessions.filter(row => row.archived && `${row.title} ${row.cwd} ${row.model}`.toLowerCase().includes(query.trim().toLowerCase()))
  React.useEffect(() => { void controller.run(controller.refresh) }, [])
  return <section className="programming-archives">
    <header><h2>{zh ? 'Codex 已归档会话' : 'Archived Codex chats'}</h2><button type="button" disabled={controller.busy} onClick={() => void controller.run(controller.refresh)}>{zh ? '刷新' : 'Refresh'}</button></header>
    <p>{zh ? '这里展示本产品管理的 Codex 编程会话，所有 Profile 共用。归档保留消息和运行数据；恢复后，会话重新出现在左侧对应项目中。' : 'Codex programming chats managed by this app are shared across Profiles. Archiving retains messages and runtime data. Restored chats reappear under their projects in the sidebar.'}</p>
    <label>{zh ? '搜索已归档会话' : 'Search archived chats'}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '会话标题、项目路径或模型' : 'Chat title, project path, or model'} /></label>
    {controller.error && <p role="alert">{controller.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!rows.length && <p>{controller.busy ? (zh ? '正在读取…' : 'Loading…') : (zh ? '没有匹配的已归档编程会话。' : 'No matching archived programming chats.')}</p>}
    <div className="programming-archive-list">{rows.map(row => <article key={row.id}>
      <div><strong>{row.title}</strong><small>{row.cwd}</small><small>{row.model}</small></div>
      <div className="programming-archive-actions"><button type="button" disabled={controller.busy} onClick={() => void controller.run(async () => { setSelected(await controller.coding.read(row.id)) })}>{zh ? '查看记录' : 'View history'}</button><button type="button" disabled={controller.busy || row.status === 'running'} onClick={() => {
        setNotice('')
        void controller.archive(row.id, false).then(saved => { if (saved) { setSelected(current => current?.id === row.id ? null : current); setNotice(zh ? '会话已恢复，可从左侧项目中打开。' : 'Chat restored. Open it from the project sidebar.') } })
      }}>{zh ? '恢复会话' : 'Restore chat'}</button></div>
    </article>)}</div>
    {selected && <section className="programming-archive-history" aria-label={zh ? '已归档会话记录' : 'Archived chat history'}>
      <header><h3>{selected.title}</h3><button type="button" onClick={() => setSelected(null)}>{zh ? '关闭记录' : 'Close history'}</button></header>
      {!selected.messages.length && <p>{zh ? '此会话暂无消息。' : 'This chat has no messages.'}</p>}
      <ProgrammingTimeline messages={selected.messages} language={language} running={false} />
      {selected.output && <MarkdownMessage text={selected.output} language={language} />}
      {selected.error && <p role="alert">{selected.error}</p>}
    </section>}
  </section>
}
