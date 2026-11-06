export type TaskModelOverride = { provider: string; model: string; effort: string }

export const EMPTY_TASK_MODEL: TaskModelOverride = { provider: '', model: '', effort: '' }

export function taskModelFrom(value: {
  provider_override?: string | null
  model_override?: string | null
  reasoning_effort?: string | null
}): TaskModelOverride {
  return {
    provider: value.provider_override || '',
    model: value.model_override || '',
    effort: value.reasoning_effort || '',
  }
}

export function taskModelCreateFields(value: TaskModelOverride): Record<string, string> {
  const model = value.model.trim()
  const provider = value.provider.trim()
  const effort = value.effort.trim()
  return {
    ...(model ? { model_override: model } : {}),
    ...(model && provider ? { provider_override: provider } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
  }
}

export function taskModelPatch(value: TaskModelOverride): Record<string, string | boolean> {
  const model = value.model.trim()
  const provider = value.provider.trim()
  const effort = value.effort.trim()
  return {
    ...(model ? { model_override: model, ...(provider ? { provider_override: provider } : {}) } : { clear_model_override: true }),
    ...(effort ? { reasoning_effort: effort } : { clear_reasoning_effort: true }),
  }
}

export function failedBulkTaskIds(results: Array<{ id: string; ok: boolean }>): string[] {
  return results.filter(item => !item.ok).map(item => item.id)
}

export function bulkStatusPatch(status: string, completionSummary: string): Record<string, string> {
  const summary = completionSummary.trim()
  return status === 'done' && summary
    ? { status, result: summary, summary }
    : { status }
}
