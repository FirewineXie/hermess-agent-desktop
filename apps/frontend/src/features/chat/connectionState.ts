import type { ChatConnectionSnapshot, ChatConnectionTarget } from '@hermess/contracts'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

const targetKinds = new Set(['plugin', 'skill', 'mcp', 'connector'])
const targetStates = new Set(['pending', 'initiated', 'connected', 'skipped', 'failed', 'expired', 'not_connected'])

function target(value: unknown): ChatConnectionTarget | undefined {
  const row = object(value)
  const name = string(row?.name)
  const kind = string(row?.kind)
  const state = string(row?.state)
  if (!row || !name || !kind || !targetKinds.has(kind) || !state || !targetStates.has(state)) return
  const scan = object(row.scan)
  const launch = object(row.launch)
  const required_env = Array.isArray(row.required_env) ? row.required_env.flatMap(item => {
    const field = object(item)
    const name = string(field?.name)
    return name && field ? [{ name, required: field.required === true, secret: field.secret === true,
      default: string(field.default) || '', prompt: string(field.prompt) }] : []
  }) : undefined
  const server_errors = Array.isArray(row.server_errors) ? row.server_errors.flatMap(item => {
    const error = object(item)
    const name = string(error?.name)
    const message = string(error?.error)
    return name && message ? [{ name, error: message }] : []
  }) : undefined
  return {
    name, kind: kind as ChatConnectionTarget['kind'], state: state as ChatConnectionTarget['state'],
    action: string(row.action) || '', resolved: row.resolved === true,
    display: string(row.display), detail: string(row.detail), description: string(row.description),
    instructions: string(row.instructions), tier: string(row.tier), repo: string(row.repo),
    sha: string(row.sha), phase: string(row.phase), target_profile: string(row.target_profile),
    scan: scan && { status: string(scan.status) || '', summary: string(scan.summary) || '' },
    launch: launch && { kind: string(launch.kind) || '', target: string(launch.target) || '',
      cwd: string(launch.cwd), env: strings(launch.env) },
    connect_url: string(row.connect_url), required_env,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : undefined,
    missing_env: strings(row.missing_env), server_errors,
  }
}

export function connectionSnapshot(value: unknown): ChatConnectionSnapshot | null {
  const row = object(value)
  if (!row || typeof row.op_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.op_id)
    || typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq) || row.seq < 0
    || typeof row.deadline_at !== 'number' || !Number.isFinite(row.deadline_at)
    || !Array.isArray(row.targets)) return null
  const targets = row.targets.map(target)
  if (targets.some(item => item === undefined)) return null
  const suggested = strings(object(row.display)?.suggested)
  return {
    op_id: row.op_id, seq: row.seq, deadline_at: row.deadline_at,
    targets: targets as ChatConnectionTarget[], settled: row.settled === true, settled_by: string(row.settled_by),
    tool_call_id: string(row.tool_call_id), display: suggested && { suggested },
  }
}

export function mergeConnectionSnapshot(current: ChatConnectionSnapshot, incoming: ChatConnectionSnapshot): ChatConnectionSnapshot {
  const latest = incoming.seq > current.seq ? incoming : current
  return {
    ...latest,
    settled: current.settled || incoming.settled,
    settled_by: latest.settled_by ?? current.settled_by ?? incoming.settled_by,
    display: latest.display ?? current.display ?? incoming.display,
    tool_call_id: latest.tool_call_id ?? current.tool_call_id ?? incoming.tool_call_id,
  }
}
