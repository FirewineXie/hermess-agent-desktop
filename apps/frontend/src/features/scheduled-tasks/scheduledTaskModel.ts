export type Job = {
  id: string; name: string; prompt: string; schedule_display?: string
  schedule?: { kind?: string; expr?: string; run_at?: string; display?: string }
  next_run_at?: string | null; last_run_at?: string | null; last_status?: string | null
  state?: string; enabled?: boolean; deliver?: string | null; skills?: string[] | null
  provider?: string | null; model?: string | null; base_url?: string | null
  script?: string | null; no_agent?: boolean; context_from?: string[] | string | null
  enabled_toolsets?: string[] | null; workdir?: string | null
  repeat?: { times: number | null; completed?: number | null } | null
  scheduler_heartbeat_age_s?: number | null; last_error?: string | null; last_delivery_error?: string | null
  last_fire_error?: { at?: string | null; detail?: string | null } | null
}
export type ScopedJob = Job & { profile: string }
export type Editor = {
  mode: 'create' | 'edit'; profile: string; id: string; name: string; schedule: string
  prompt: string; deliver: string; skills: string[]; provider: string; model: string
  base_url: string; script: string; no_agent: boolean; context_from: string
  continuity: boolean; enabled_toolsets: string[]; workdir: string; repeat: string; paused: boolean
}

const split = (value: unknown): string[] => Array.isArray(value) ? value.map(String).filter(Boolean)
  : typeof value === 'string' ? value.split(/[\n,]/).map(item => item.trim()).filter(Boolean) : []

export function newEditor(profile: string): Editor {
  return { mode: 'create', profile, id: '', name: '', schedule: 'every 30m', prompt: '', deliver: 'local',
    skills: [], provider: '', model: '', base_url: '', script: '', no_agent: false,
    context_from: '', continuity: false, enabled_toolsets: [], workdir: '', repeat: '', paused: false }
}

export function editJob(job: ScopedJob): Editor {
  const references = split(job.context_from)
  return { ...newEditor(job.profile), mode: 'edit', id: job.id, name: job.name || '',
    schedule: job.schedule?.expr || job.schedule?.run_at || job.schedule_display || '',
    prompt: job.prompt || '', deliver: job.deliver || 'local', skills: split(job.skills),
    provider: job.provider || '', model: job.model || '', base_url: job.base_url || '',
    script: job.script || '', no_agent: Boolean(job.no_agent),
    context_from: references.filter(item => item.toLowerCase() !== 'self').join('\n'),
    continuity: references.some(item => item.toLowerCase() === 'self'),
    enabled_toolsets: split(job.enabled_toolsets), workdir: job.workdir || '',
    repeat: job.repeat?.times ? String(job.repeat.times) : '', paused: !job.enabled }
}

export function editorPayload(editor: Editor) {
  const context = split(editor.context_from).filter(item => item.toLowerCase() !== 'self')
  if (editor.continuity) context.push('self')
  return {
    profile: editor.profile, ...(editor.mode === 'edit' ? { id: editor.id } : {}),
    name: editor.name.trim(), schedule: editor.schedule.trim(), prompt: editor.prompt.trim(),
    deliver: editor.deliver, skills: editor.skills, provider: editor.provider || null,
    model: editor.model || null, base_url: editor.base_url.trim() || null,
    script: editor.script.trim() || null, no_agent: editor.no_agent,
    context_from: context.length ? context : null,
    enabled_toolsets: editor.enabled_toolsets.length ? editor.enabled_toolsets : null,
    workdir: editor.workdir.trim() || null,
    ...(editor.mode === 'create' ? { repeat: editor.repeat || null, paused: editor.paused } : {}),
  }
}
