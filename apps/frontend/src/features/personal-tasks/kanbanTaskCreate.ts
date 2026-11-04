export type KanbanTaskCreateInput = {
  assignee: string
  resolvedDefaultAssignee: string
  priority: string
  skills: string
  workspaceKind: string
  workspacePath: string
  parent: string
  goalMode: boolean
  goalMaxTurns: string
  targetStatus: string
}

export function taskCreateOptions(input: KanbanTaskCreateInput): Record<string, unknown> {
  const skills = input.skills.split(',').map(value => value.trim()).filter(Boolean)
  const assignee = input.assignee === '__parked__'
    ? undefined
    : input.assignee || input.resolvedDefaultAssignee || 'default'
  const goalMaxTurns = Number.parseInt(input.goalMaxTurns, 10)
  return {
    ...(assignee ? { assignee } : {}),
    priority: Number(input.priority) || 0,
    workspace_kind: input.workspaceKind || 'scratch',
    ...(input.workspaceKind !== 'scratch' && input.workspacePath.trim()
      ? { workspace_path: input.workspacePath.trim() } : {}),
    ...(input.parent ? { parents: [input.parent] } : {}),
    ...(skills.length ? { skills } : {}),
    goal_mode: input.goalMode,
    ...(input.goalMode && Number.isInteger(goalMaxTurns) && goalMaxTurns > 0 ? { goal_max_turns: goalMaxTurns } : {}),
    triage: input.targetStatus === 'triage',
  }
}
