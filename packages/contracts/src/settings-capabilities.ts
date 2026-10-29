export type ProviderCopyPreview = { source: string; endpointId: string; target: string; digest: string; eligible: boolean; reason: string; name: string; models: string[] }
export type ProviderCopyResult = { status: 'copied' | 'unverified'; endpointId: string }
export type DelegationModelRoute = {
  name: string; description: string; provider?: string; model: string; base_url?: string; api_mode?: string
  reasoning_effort?: string; service_tier?: string; fallback_providers?: Array<{ provider: string; model: string }>
  request_overrides?: Record<string, unknown>; has_api_key?: boolean
  original_name?: string; credential?: { action: 'keep' | 'replace' | 'clear'; value?: string }
}
export type DelegationRouting = {
  configured: string; blocked_reason: string | null
  backends: Array<{ name: string; available: boolean; reason?: string; unavailable_reason?: string; summary?: string }>
  model_map: { options: DelegationModelRoute[]; default: string | null }
  profile_routes: { profiles: Array<{ name: string; description?: string }>; default: string | null }
  profiles: string[]
}
export type DevicePreferences = { keepAwake: boolean; f12Devtools: boolean; quickEnabled: boolean; shortcut: string }
export type DeviceStatus = { preferences: DevicePreferences; registered: boolean; awake: boolean; f12Supported: boolean; error: string | null }
export type QuickTarget = { profile: string; sessionId: string; epoch: string; busy: boolean }
export type QuickSubmission = { requestId: string; target: QuickTarget; text: string }
