export type ExtensionTab = 'skills' | 'mcp' | 'skillHub' | 'mcpCatalog'

export type LocalSkill = {
  name: string; description?: string; category?: string; provenance?: string;
  enabled: boolean; usage?: number; sourceIdentifier?: string
}
export type HubSkill = {
  name: string; description?: string; source: string; identifier: string;
  trust_level?: string; installed?: boolean; repo?: string
}
export type HubPreview = HubSkill & { skill_md?: string; files?: string[]; digest?: string }
export type HubScan = { policy: 'allow' | 'ask' | 'block'; summary?: string; policy_reason?: string; digest?: string }
export type McpServer = {
  name: string; transport: string; url?: string; command?: string; args?: string[];
  auth?: string; enabled: boolean; source: string; plugin?: string
}
export type McpCatalogEntry = {
  name: string; identifier?: string; description?: string; source?: string; transport: string;
  auth_type?: string; required_env?: Array<{ name: string; prompt?: string; required: boolean }>;
  command?: string; args?: string[]; url?: string; bootstrap?: string[];
  needs_install?: boolean; installed: boolean; enabled: boolean;
  version?: string; repository?: string; catalog_url?: string; installable?: boolean; install_name?: string;
  manual_url?: string; package_hint?: string; readme_excerpt?: string
}
export type ActionStart = { name?: string; action?: string; background?: boolean }
export type ActionStatus = { running: boolean; exit_code: number | null }
