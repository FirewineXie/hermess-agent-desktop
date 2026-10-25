export type ExtensionTab = 'skills' | 'mcp' | 'skillHub' | 'mcpCatalog'

export type LocalSkill = {
  name: string; description?: string; category?: string; provenance?: string;
  enabled: boolean; usage?: number
}
export type HubSkill = {
  name: string; description?: string; source: string; identifier: string;
  trust_level?: string; installed?: boolean
}
export type HubPreview = HubSkill & { skill_md?: string; files?: string[] }
export type HubScan = { policy: 'allow' | 'ask' | 'block'; summary?: string; policy_reason?: string }
export type McpServer = {
  name: string; transport: string; url?: string; command?: string; args?: string[];
  auth?: string; enabled: boolean; source: string; plugin?: string
}
export type McpCatalogEntry = {
  name: string; description?: string; source?: string; transport: string;
  auth_type?: string; required_env?: Array<{ name: string; prompt?: string; required: boolean }>;
  command?: string; args?: string[]; url?: string; bootstrap?: string[];
  needs_install?: boolean; installed: boolean; enabled: boolean
}
export type ActionStart = { name?: string; action?: string; background?: boolean }
export type ActionStatus = { running: boolean; exit_code: number | null }
