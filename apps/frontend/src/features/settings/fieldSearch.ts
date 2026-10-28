import type { SettingsLocation } from './model'

export function auxiliaryTaskFromField(key: string): string | null {
  const match = /^auxiliary\.([a-zA-Z0-9_]+)\.(provider|model|reasoning_effort|timeout)$/.exec(key)
  return match && match[1] !== 'compression' ? match[1] : null
}

/** Route Schema fields to the visible editor that owns them. */
export function fieldSettingsLocation(key: string): SettingsLocation | null {
  if (key === 'model_context_length' || key === 'agent.reasoning_effort' || key === 'agent.service_tier') return { category: 'model', subpage: 'main' }
  if (key === 'fallback_providers') return { category: 'model', subpage: 'fallbacks' }
  if (auxiliaryTaskFromField(key)) return { category: 'model', subpage: 'auxiliary' }
  if (key.startsWith('delegation.')) return { category: 'model', subpage: 'delegation' }
  if (key.startsWith('moa.')) return { category: 'model', subpage: 'moa' }
  if (key.startsWith('memory.')) return { category: 'memory', subpage: 'persistent' }
  if (key.startsWith('context.') || key.startsWith('compression.') || key.startsWith('auxiliary.compression.')) return { category: 'memory', subpage: 'context' }
  if (key === 'command_allowlist' || key.startsWith('approvals.')) return { category: 'security', subpage: 'approvals' }
  if (key.startsWith('security.')) return { category: 'security', subpage: 'privacy' }
  if (key.startsWith('checkpoints.')) return { category: 'security', subpage: 'checkpoints' }
  if (key.startsWith('stt.')) return { category: 'voice', subpage: 'transcription' }
  if (key.startsWith('tts.') || key === 'voice.auto_tts') return { category: 'voice', subpage: 'speech' }
  if (key.startsWith('updates.')) return { category: 'advanced', subpage: 'desktop' }
  if (key === 'agent.max_turns' || key === 'agent.api_max_retries') return { category: 'advanced', subpage: 'runtime' }
  if (key === 'toolsets' || key === 'agent.tool_use_enforcement') return { category: 'advanced', subpage: 'tools' }
  if (key.startsWith('terminal.')) return { category: 'advanced', subpage: 'terminal' }
  if (key.startsWith('tool_output.')) return { category: 'advanced', subpage: 'output' }
  // The raw page renders the complete runtime Schema in form mode. Keep hidden
  // connection and device capabilities out of search until their UI is released.
  if (key.startsWith('voice.') || key.startsWith('gateway.') || key.startsWith('cloud.') || key.startsWith('ssh.') || key.startsWith('remote.')) return null
  return { category: 'advanced', subpage: 'raw' }
}

/** Dedicated editors do not expose the ConfigTree text filter. */
export function fieldSupportsTextTarget(key: string): boolean {
  return key !== 'fallback_providers' && !auxiliaryTaskFromField(key) && !key.startsWith('moa.')
}
