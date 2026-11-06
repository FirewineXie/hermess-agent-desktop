import type { PersonalTaskDetail } from '@hermess/contracts'

type TaskEvent = PersonalTaskDetail['events'][number]

const labels: Record<string, [string, string]> = {
  created: ['任务已建立', 'Task created'],
  hermess_created: ['已加入持续任务看板', 'Added to ongoing tasks'],
  promoted: ['已进入待执行队列', 'Queued for execution'],
  claimed: ['已领取任务', 'Task claimed'],
  spawned: ['已启动执行进程', 'Worker started'],
  worker_bound: ['执行进程已连接', 'Worker connected'],
  commented: ['新增任务记录', 'Activity added'],
  attached: ['新增成果附件', 'Attachment added'],
  blocked: ['需要处理或补充信息', 'Input or review needed'],
  hermess_input: ['已收到补充信息', 'Additional input received'],
  hermess_resumed: ['已恢复原任务', 'Task resumed'],
  unblocked: ['已解除阻塞', 'Block cleared'],
  review_requested: ['等待审核', 'Awaiting review'],
  completed: ['任务已完成', 'Task completed'],
  crashed: ['执行进程异常结束', 'Worker stopped unexpectedly'],
  timed_out: ['执行超时', 'Execution timed out'],
  reclaimed: ['执行已中断', 'Execution interrupted'],
  archived: ['任务已归档', 'Task archived'],
}

export function visibleTaskEvents(events: TaskEvent[], zh: boolean) {
  return events.filter(event => labels[event.kind]).map(event => ({
    id: event.id,
    kind: event.kind,
    label: labels[event.kind][zh ? 0 : 1],
    time: event.created_at,
  }))
}

export function taskEventTime(value: number, language: string) {
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(language, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}
