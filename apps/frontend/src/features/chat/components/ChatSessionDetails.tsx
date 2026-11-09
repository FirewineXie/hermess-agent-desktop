import type { useChatSessionDetails } from '../useChatSessionDetails'

export default function ChatSessionDetails({ details, zh }: {
  details: ReturnType<typeof useChatSessionDetails>['visible']; zh: boolean
}) {
  if (!details) return null
  const todos = details.todo?.todos ?? []
  const completed = todos.filter(todo => todo.status === 'completed').length
  const controlNames = { goal: zh ? '目标' : 'Goal', loop: zh ? '循环' : 'Loop', heartbeat: zh ? '心跳' : 'Heartbeat' }
  const statuses: Record<string, string> = zh
    ? { pending: '待完成', in_progress: '进行中', completed: '已完成', cancelled: '已取消', active: '运行中', paused: '已暂停' }
    : { pending: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', active: 'Active', paused: 'Paused' }
  return <>
    {!!details.controls?.length && <section className="request-card" aria-label={zh ? '会话自动化状态' : 'Session automation'}>
      {details.controls.map(row => <p key={row.kind}><strong>{controlNames[row.kind]}</strong> · {statuses[row.status] || row.status} · {row.text}</p>)}
    </section>}
    {!!todos.length && <details className="request-card">
      <summary>{zh ? '本会话待办' : 'Session tasks'} · {completed}/{todos.length}</summary>
      <ul>{todos.map((todo, index) => <li key={`${todo.id}-${index}`}>{todo.parent && '↳ '}{todo.content} · {statuses[todo.status] || todo.status}</li>)}</ul>
    </details>}
    {details.review && <details className="request-card">
      <summary>{zh ? '后台审查结果' : 'Background review'}</summary>
      <p>{details.review}</p>
    </details>}
  </>
}
