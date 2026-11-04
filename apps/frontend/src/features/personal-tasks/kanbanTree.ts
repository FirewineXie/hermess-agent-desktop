import type { KanbanTask } from './kanbanApi'

export type KanbanTreeRow = {
  task: KanbanTask
  depth: number
  hasChildren: boolean
}

export function buildKanbanTaskTree(
  roots: KanbanTask[],
  childrenByParent: Readonly<Record<string, readonly string[]>>,
  collapsed: ReadonlySet<string>,
  catalog: KanbanTask[] = roots,
): KanbanTreeRow[] {
  const taskById = new Map(catalog.map(task => [task.id, task]))
  const order = new Map(catalog.map((task, index) => [task.id, index]))
  const chosenParent = new Map<string, string>()
  const children = new Map<string, string[]>()

  const reachable = [...roots]
  const expanded = new Set<string>()
  while (reachable.length) {
    const parent = reachable.shift()!
    if (expanded.has(parent.id)) continue
    expanded.add(parent.id)
    const seen = new Set<string>()
    for (const childId of childrenByParent[parent.id] || []) {
      if (childId === parent.id || seen.has(childId) || !taskById.has(childId)) continue
      seen.add(childId)
      if (!chosenParent.has(childId)) chosenParent.set(childId, parent.id)
      const child = taskById.get(childId)
      if (child) reachable.push(child)
    }
  }
  for (const [childId, parentId] of chosenParent) {
    children.set(parentId, [...(children.get(parentId) || []), childId])
  }
  for (const childIds of children.values()) {
    childIds.sort((left, right) => (order.get(left) || 0) - (order.get(right) || 0))
  }

  const rows: KanbanTreeRow[] = []
  const visited = new Set<string>()
  const visit = (taskId: string, depth: number, path: ReadonlySet<string>) => {
    if (visited.has(taskId) || path.has(taskId)) return
    const task = taskById.get(taskId)
    if (!task) return
    visited.add(taskId)
    const childIds = (children.get(taskId) || []).filter(id => !path.has(id))
    rows.push({ task, depth, hasChildren: childIds.length > 0 })
    if (collapsed.has(taskId)) return
    const nextPath = new Set(path).add(taskId)
    for (const childId of childIds) visit(childId, depth + 1, nextPath)
  }

  for (const task of roots) {
    if (!chosenParent.has(task.id)) visit(task.id, 0, new Set())
  }
  const reachesVisibleAncestor = (taskId: string) => {
    const chain = new Set<string>([taskId])
    let parentId = chosenParent.get(taskId)
    while (parentId) {
      if (visited.has(parentId)) return true
      if (chain.has(parentId)) return false
      chain.add(parentId)
      parentId = chosenParent.get(parentId)
    }
    return false
  }
  for (const task of roots) {
    if (!visited.has(task.id) && !reachesVisibleAncestor(task.id)) visit(task.id, 0, new Set())
  }
  return rows
}
