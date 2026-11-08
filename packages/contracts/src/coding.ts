export type CodingConfig = {
  id: string; enabled: boolean; base_url: string; model: string; effort: string
  executable: string; has_key: boolean; ignored_fields: string[]
}
export type CodingConfigDraft = Omit<CodingConfig, 'id' | 'has_key' | 'executable' | 'ignored_fields'> & { api_key?: string }
export type CodingRuntimeStatus = { tag: string; version: string; supported: boolean; state: 'missing' | 'downloading' | 'installing' | 'installed' | 'failed'; downloaded: number; total: number }
export type CodingTool = { id: string; type: string; status: string; summary: string; detail: string; output: string; cwd?: string; exit_code?: number | null; skill_paths?: string[]; changes?: { path: string; kind: string; added: number; removed: number }[] }
export type CodingMessage = { role: 'user' | 'assistant'; text: string; images: string[]; tool?: CodingTool; timing?: { started_at_ms: number; elapsed_ms?: number } }
export type CodingSkill = { name: string; description: string; path: string; enabled: boolean }
export type CodingSkillCatalog = { skills: CodingSkill[]; errors: { path: string; message: string }[] }
export type CodingProject = { id: string; name: string; cwd: string; legacy_cwds: string[] }
export type CodingContext = { effort?: string; approval_policy?: string; approvals_reviewer?: string; permissions?: string; used_tokens?: number; context_window?: number; mode?: 'plan' | 'default'; active_command?: 'goal' | 'compact' | 'review' | null; goal?: import('./codingCommands').CodingGoal | null; question?: import('./codingCommands').CodingQuestion | null }
export type { CodingCommand, CodingGoal, CodingQuestion } from './codingCommands'
export type CodingApprovalOption = { id: string; kind: 'once' | 'session' | 'command_rule' | 'network_rule' | 'deny' | 'cancel'; detail: string }
export type CodingApproval = { id: string; command: string; description: string; cwd?: string; source?: 'codex' | 'computer' | 'mcp'; options: CodingApprovalOption[] }
export type CodingGitState = { state: 'repository' | 'not_repository' | 'unavailable'; branch: string | null; detached: boolean; branches: string[]; switch_error?: 'rejected' }
export type CodingSession = {
  archived?: boolean
  context?: CodingContext | null
  project_id?: string | null
  id: string; title: string; cwd: string; config_id: string; model: string
  thread_id: string | null; messages: CodingMessage[]; status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  output: string; error: string; activity: string; approval: CodingApproval | null
}
export interface CodingApi {
  command(id: string, command: import('./codingCommands').CodingCommand, permissions?: string, effort?: string): Promise<void>
  answer(id: string, requestId: string, answers: Record<string, { answers: string[] }>): Promise<void>
  openSkillDirectory(): Promise<void>
  settings(): Promise<import('./codingSettings').CodingSettings>
  configFile(): Promise<import('./codingSettings').CodingTextFile>
  saveConfigFile(revision: string, content: string): Promise<import('./codingSettings').CodingTextFile>
  saveSettings(draft: import('./codingSettings').CodingSettings): Promise<import('./codingSettings').CodingSettings>
  settingsProbe(cwd: string, server?: string, login?: boolean): Promise<import('./codingSettings').CodingSettingsProbe>
  projectInstruction(cwd: string): Promise<import('./codingSettings').CodingTextFile>
  saveProjectInstruction(cwd: string, revision: string, content: string): Promise<import('./codingSettings').CodingTextFile>
  skills(cwd: string): Promise<CodingSkillCatalog>
  permissionSettings(): Promise<CodingPermissionSettings>
  savePermissionSettings(draft: CodingPermissionDraft): Promise<CodingPermissionSettings>
  openPermissionConfig(): Promise<void>
  permissionProfiles(cwd: string): Promise<CodingPermissionProfile[]>
  catalog(): Promise<CodingCatalog>
  saveProvider(draft: CodingProviderDraft): Promise<CodingProviderResult>
  profileProviders(profile: string): Promise<CodingProfileProvider[]>
  syncProfile(profile: string, provider: string): Promise<CodingProviderResult>
  removeProvider(id: string): Promise<CodingProviderResult>
  preferences(enabled: boolean, effort: string): Promise<CodingProviderResult>
  runtime(): Promise<CodingRuntimeStatus>
  installRuntime(): Promise<void>
  config(): Promise<CodingConfig>
  saveConfig(draft: CodingConfigDraft): Promise<CodingConfig>
  sessions(): Promise<CodingSession[]>
  projects(): Promise<CodingProject[]>
  branch(cwd: string): Promise<CodingGitState>
  switchBranch(cwd: string, branch: string): Promise<CodingGitState>
  saveProject(id: string | null, name: string, cwd: string): Promise<CodingProject>
  create(cwd: string, projectId?: string, modelId?: string): Promise<CodingSession>
  read(id: string): Promise<CodingSession>
  archive(id: string, archived: boolean): Promise<CodingSession>
  /** Images are absolute local paths or base64 PNG/JPEG/GIF/WebP data URLs; up to four, 20 MiB total. */
  send(id: string, text: string, images?: string[], permissions?: string, effort?: string): Promise<void>
  stop(id: string): Promise<void>
  approve(id: string, requestId: string, optionId: string): Promise<void>
  remove(id: string): Promise<void>
}

export type CodingPermissionProfile = { id: string; description?: string | null; allowed: boolean }
export type CodingPermissionDraft = {
  revision: string
  default_permissions: string
  approval_policy: 'on-request' | 'never'
  approvals_reviewer: 'user' | 'auto_review'
  network_access?: boolean | null
  writable_roots?: string[]
}
export type CodingPermissionSettings = Omit<CodingPermissionDraft, 'approval_policy'> & {
  approval_policy: CodingPermissionDraft['approval_policy'] | 'on-failure' | 'untrusted'
  profiles: string[]
  profile_rules?: Record<string, { network_access: boolean | null; writable_roots: string[] }>
}

export type CodingModel = { id: string; name: string }
export type CodingProvider = { id: string; name: string; region: 'domestic' | 'overseas' | 'custom'; base_url: string; has_key: boolean; models: CodingModel[] }
export type CodingCatalog = { revision: string; enabled: boolean; effort: string; default_model: string; providers: CodingProvider[] }
export type CodingProviderDraft = { id?: string | null; name: string; region: CodingProvider['region']; base_url: string; api_key?: string; models: string[] }
export type CodingValidationStage = 'profile' | 'authentication' | 'endpoint' | 'stream' | 'tool_call' | 'tool_result' | 'connection' | 'timeout'
export type CodingProfileProvider = { id: string; name: string; base_url: string; models: string[] }
export type CodingProviderResult = { profile_providers?: CodingProfileProvider[] | null; catalog: CodingCatalog | null; error: CodingValidationStage | null }
