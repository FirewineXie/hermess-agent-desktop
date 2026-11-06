export const kanbanStatusLabels: Record<string, string> = {
  triage: '待分类', todo: '待办', scheduled: '已计划', ready: '就绪',
  running: '进行中', blocked: '需处理', review: '待审核', done: '已完成', archived: '已归档',
}

export function kanbanStatusLabel(status: string): string {
  return kanbanStatusLabels[status] || status
}
