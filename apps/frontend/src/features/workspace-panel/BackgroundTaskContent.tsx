import type { MediaScope } from '@hermess/contracts'
import type { BackgroundTask } from '../chat/backgroundTasks'
import { ChatMediaProvider } from '../chat/ChatMediaContext'
import MarkdownMessage from '../chat/components/MarkdownMessage'

export default function BackgroundTaskContent({ task, taskId, profile, mediaScope, zh, language }: {
  task?: BackgroundTask; taskId: string; profile?: string; mediaScope: MediaScope | null
  zh: boolean; language: 'zh-CN' | 'en-US'
}) {
  const statuses = {
    running: zh ? '运行中' : 'Running', unknown: zh ? '结果待确认' : 'Result uncertain',
    failed: zh ? '失败' : 'Failed', complete: zh ? '已完成' : 'Complete',
  }
  return <div className="panel-background-task">
    <div className="panel-background-task-header"><strong>{zh ? '后台任务' : 'Background task'}</strong><span>{task ? statuses[task.status] : zh ? '切换到所属会话查看' : 'Open the owning session'}</span></div>
    <div className="panel-background-task-messages">
      {task?.prompt && <details className="panel-background-task-prompt"><summary>{zh ? '任务要求' : 'Task prompt'} · <span>{task.prompt}</span></summary><p className="panel-background-task-user">{task.prompt}</p></details>}
      {task?.result && <div className="panel-background-task-assistant"><ChatMediaProvider scope={mediaScope}><MarkdownMessage text={task.result} language={language} /></ChatMediaProvider></div>}
    </div>
    <details className="panel-background-task-meta"><summary>{zh ? '任务信息' : 'Task information'}</summary><small>{profile} · {taskId}</small></details>
    {task?.truncated && <small>{zh ? '结果过长，仅显示部分内容。' : 'The result is too long; only part is shown.'}</small>}
  </div>
}
