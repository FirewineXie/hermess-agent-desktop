import type { GatewayEvent, ResumeResult } from '@hermess/contracts'
import { useProfileState } from '../../app/profile-scope/ProfileWorkspace'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

type Todo = { id: string; content: string; status: string; parent?: string }
type TodoState = { revision: number; todos: Todo[] }
type ControlRow = { kind: 'goal' | 'loop' | 'heartbeat'; text: string; status: string }
type SessionDetails = { session: string; todo?: TodoState; controls?: ControlRow[]; review?: string }

export function readTodoState(value: unknown): TodoState | undefined {
  const source = record(value)
  if (!source || typeof source.revision !== 'number' || !Number.isSafeInteger(source.revision) ||
    source.revision < 0 || !Array.isArray(source.todos)) return
  return {
    revision: source.revision,
    todos: source.todos.flatMap(value => {
      const item = record(value)
      if (!item || typeof item.id !== 'string' || typeof item.content !== 'string' || typeof item.status !== 'string') return []
      return [{ id: item.id, content: item.content, status: item.status,
        parent: typeof item.parent === 'string' ? item.parent : undefined }]
    }),
  }
}

function readControl(value: unknown): ControlRow[] {
  const snapshot = record(value)
  if (!snapshot) return []
  return (['goal', 'loop', 'heartbeat'] as const).flatMap(kind => {
    const control = record(snapshot[kind])
    const text = kind === 'goal' ? control?.title : control?.prompt
    return control && typeof text === 'string' && typeof control.status === 'string'
      ? [{ kind, text, status: control.status }] : []
  })
}

export function useChatSessionDetails(workspace: string, session: string) {
  const [details, setDetails] = useProfileState<SessionDetails | null>(workspace, null, 'chat:session-details')

  function receive(event: GatewayEvent) {
    if (!event.session_id) return false
    const id = event.session_id
    function update(change: (previous: SessionDetails) => SessionDetails) {
      setDetails(previous => change(previous?.session === id ? previous : { session: id }))
    }
    if (event.kind === 'todo.updated') {
      const todo = readTodoState(event.payload)
      if (todo) update(previous => previous.todo && previous.todo.revision >= todo.revision ? previous : { ...previous, todo })
    } else if (event.kind === 'session.control.update') {
      const controls = readControl(event.payload.control)
      update(previous => ({ ...previous, controls }))
    } else if (event.kind === 'review.summary') {
      const text = event.payload.text
      if (typeof text === 'string' && text.trim()) update(previous => ({ ...previous, review: text }))
    } else return false
    return true
  }

  function restore(result: ResumeResult) {
    const todo = readTodoState(result.todo_state)
    setDetails(previous => ({
      ...(previous?.session === result.session_id ? previous : null),
      session: result.session_id,
      todo,
    }))
  }

  return { visible: details?.session === session ? details : null, receive, restore }
}
