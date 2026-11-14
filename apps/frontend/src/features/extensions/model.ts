export type LocalSkill = {
  name: string; description?: string; category?: string; provenance?: string;
  enabled: boolean; locked?: boolean; usage?: number; sourceIdentifier?: string
}
export type HubSkill = {
  name: string; description?: string; source: string; identifier: string;
  trust_level?: string; installed?: boolean; repo?: string
}
export type HubPreview = HubSkill & { skill_md?: string; files?: string[]; digest?: string }
export type HubScanFinding = {
  severity: string; category: string; file: string; line?: number; description: string
}
export type HubScan = {
  policy: 'allow' | 'ask' | 'block'; summary?: string; policy_reason?: string; digest?: string;
  verdict?: string; findings?: HubScanFinding[]; severity_counts?: Record<string, number>
}
export type McpServer = {
  name: string; transport: string; url?: string; command?: string; args?: string[];
  env?: Record<string, string>; auth?: string; enabled: boolean; source: string; plugin?: string
}
export type McpSetupOption = { transport: 'http'; url: string } | { transport: 'stdio'; command: string; args: string[]; env_keys: string[] }
export type McpSetupDraft = { operation: string; name: string; option?: McpSetupOption; documentation?: string }
export type McpCatalogEntry = {
  name: string; identifier?: string; description?: string; source?: string; transport: string;
  auth_type?: string; required_env?: Array<{ name: string; prompt?: string; required: boolean }>;
  command?: string; args?: string[]; url?: string; bootstrap?: string[];
  needs_install?: boolean; installed: boolean; enabled: boolean;
  version?: string; repository?: string; catalog_url?: string; installable?: boolean; install_name?: string;
  manual_url?: string; package_hint?: string; readme_excerpt?: string; setup_options?: McpSetupOption[]
}
export type ActionStart = { name?: string; action?: string; background?: boolean }
export type ActionStatus = { running: boolean; exit_code: number | null }
