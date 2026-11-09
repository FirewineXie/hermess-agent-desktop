// @ts-nocheck
// Synchronized from locked Hermes Dashboard web/src/lib/api.ts.
export function createDashboardPluginAdminApi(runtime: any) {
  const { fetchJSON, authedFetch, buildWsUrl, getManagementProfile, appendProfileParam, profileQuery, pluginPath } = runtime
  return {
  getPlugins: (profile = getManagementProfile()) => // the profile the caller's asset URLs will name
    fetchJSON<PluginManifestResponse[]>(`/api/dashboard/plugins${profile ? `?profile=${encodeURIComponent(profile)}` : ""}`),
  rescanPlugins: () =>
    fetchJSON<{ ok: boolean; count: number }>("/api/dashboard/plugins/rescan"),

  getPluginsHub: () => fetchJSON<PluginsHubResponse>("/api/dashboard/plugins/hub"),

  getPluginsCatalog: () =>
    fetchJSON<CatalogResponse>("/api/dashboard/plugins/catalog"),

  installAgentPlugin: (body: AgentPluginInstallRequest) =>
    fetchJSON<AgentPluginInstallResponse>("/api/dashboard/agent-plugins/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body }),
    }),

  enableAgentPlugin: (name: string) =>
    fetchJSON<{
      ok: boolean;
      name: string;
      unchanged?: boolean;
      restart_required?: boolean;
    }>(`/api/dashboard/agent-plugins/${pluginPath(name)}/enable`, {
      method: "POST",
    }),

  disableAgentPlugin: (name: string) =>
    fetchJSON<{
      ok: boolean;
      name: string;
      unchanged?: boolean;
      restart_required?: boolean;
    }>(`/api/dashboard/agent-plugins/${pluginPath(name)}/disable`, {
      method: "POST",
    }),

  updateAgentPlugin: (
    name: string,
    { acceptCapabilities = false, force = false }: { acceptCapabilities?: boolean; force?: boolean } = {},
  ) =>
    fetchJSON<AgentPluginUpdateResponse>(
      `/api/dashboard/agent-plugins/${pluginPath(name)}/update`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept_capabilities: acceptCapabilities, force }),
      },
    ),

  updateAllAgentPlugins: () =>
    fetchJSON<AgentPluginsUpdateAllResponse>("/api/dashboard/agent-plugins/update-all", {
      method: "POST",
    }),

  getPluginAutoUpdate: () =>
    fetchJSON<PluginAutoUpdateState>("/api/dashboard/plugins/auto-update"),

  setPluginAutoUpdate: (enabled: boolean) =>
    fetchJSON<PluginAutoUpdateState>("/api/dashboard/plugins/auto-update", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),

  removeAgentPlugin: (name: string) =>
    fetchJSON<{ ok: boolean; name: string }>(
      `/api/dashboard/agent-plugins/${pluginPath(name)}`,
      { method: "DELETE" },
    ),

  savePluginProviders: (body: PluginProvidersPutRequest) =>
    fetchJSON<{ ok: boolean }>("/api/dashboard/plugin-providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  setPluginVisibility: (name: string, hidden: boolean) =>
    fetchJSON<{ ok: boolean; name: string; hidden: boolean }>(
      `/api/dashboard/plugins/${pluginPath(name)}/visibility`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      },
    ),

  // Dashboard themes
  getThemes: () =>
    fetchJSON<DashboardThemesResponse>("/api/dashboard/themes"),
  setTheme: (name: string) =>
    fetchJSON<{ ok: boolean; theme: string }>("/api/dashboard/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  getFontPref: () =>
    fetchJSON<DashboardFontResponse>("/api/dashboard/font"),
  setFontPref: (font: string) =>
    fetchJSON<{ ok: boolean; font: string }>("/api/dashboard/font", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ font }),
    }),

  // ── Admin: MCP servers ──────────────────────────────────────────────
  getMcpServers: () => fetchJSON<{ servers: McpServer[] }>("/api/mcp/servers"),
  addMcpServer: (body: McpServerCreate) =>
    fetchJSON<McpServer>("/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  authMcpServer: (name: string) =>
    fetchJSON<McpOAuthFlow>(
      `/api/mcp/servers/${encodeURIComponent(name)}/auth`,
      { method: "POST" },
    ),
  getMcpOAuthFlow: (flowId: string) =>
    fetchJSON<McpOAuthFlow>(
      `/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`,
    ),
  removeMcpServer: (name: string) =>
    fetchJSON<{ ok: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  testMcpServer: (name: string) =>
    fetchJSON<McpTestResult>(
      `/api/mcp/servers/${encodeURIComponent(name)}/test`,
      { method: "POST" },
    ),
  setMcpServerEnabled: (name: string, enabled: boolean) =>
    fetchJSON<{ ok: boolean; name: string; enabled: boolean }>(
      `/api/mcp/servers/${encodeURIComponent(name)}/enabled`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    ),
  getMcpCatalog: () =>
    fetchJSON<{ entries: McpCatalogEntry[]; diagnostics: McpCatalogDiagnostic[] }>(
      "/api/mcp/catalog",
    ),
  installMcpCatalogEntry: (
    name: string,
    env: Record<string, string> = {},
    enable = true,
  ) =>
    fetchJSON<{ ok: boolean; name: string; background: boolean; action?: string }>(
      "/api/mcp/catalog/install",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, env, enable }),
      },
    ),

  // ── Admin: Pairing ──────────────────────────────────────────────────
  // The mutating endpoints read the profile off the BODY, so the query-param
  // rewrite in withManagementProfile doesn't reach them — send it explicitly
  // or an approval lands in the wrong profile's whitelist.
  getPairing: () => fetchJSON<PairingResponse>("/api/pairing"),
  approvePairing: (platform: string, request_id: string) =>
    fetchJSON<{ ok: boolean; user: PairingUser }>("/api/pairing/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        request_id,
        profile: getManagementProfile() || undefined,
      }),
    }),
  revokePairing: (platform: string, user_id: string) =>
    fetchJSON<{ ok: boolean }>("/api/pairing/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        user_id,
        profile: getManagementProfile() || undefined,
      }),
    }),
  clearPendingPairing: () =>
    fetchJSON<{ ok: boolean; cleared: number }>("/api/pairing/clear-pending", {
      method: "POST",
    }),

  // ── Admin: Webhooks ─────────────────────────────────────────────────
  getWebhooks: () => fetchJSON<WebhooksResponse>("/api/webhooks"),
  enableWebhooks: () =>
    fetchJSON<WebhookEnableResponse>("/api/webhooks/enable", { method: "POST" }),
  createWebhook: (body: WebhookCreate) =>
    fetchJSON<WebhookRoute & { secret: string }>("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteWebhook: (name: string) =>
    fetchJSON<{ ok: boolean }>(`/api/webhooks/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  setWebhookEnabled: (name: string, enabled: boolean) =>
    fetchJSON<{ ok: boolean; name: string; enabled: boolean }>(
      `/api/webhooks/${encodeURIComponent(name)}/enabled`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    ),

  // ── Admin: Credential pool ──────────────────────────────────────────
  getCredentialPool: () =>
    fetchJSON<{ providers: CredentialPoolProvider[] }>("/api/credentials/pool"),
  addCredentialPoolEntry: (
    provider: string,
    api_key: string,
    label?: string,
  ) =>
    fetchJSON<{ ok: boolean; provider: string; count: number }>(
      "/api/credentials/pool",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key, label }),
      },
    ),
  removeCredentialPoolEntry: (provider: string, index: number) =>
    fetchJSON<{ ok: boolean; provider: string; count: number }>(
      `/api/credentials/pool/${encodeURIComponent(provider)}/${index}`,
      { method: "DELETE" },
    ),

  // ── Admin: Memory provider ──────────────────────────────────────────
  getMemory: () => fetchJSON<MemoryStatus>("/api/memory"),
  getMemoryProviderConfig: (provider: string) =>
    fetchJSON<MemoryProviderConfig>(
      `/api/memory/providers/${encodeURIComponent(provider)}/config`,
    ),
  updateMemoryProviderConfig: (provider: string, values: Record<string, unknown>) =>
    fetchJSON<{ ok: boolean; active: string }>(
      `/api/memory/providers/${encodeURIComponent(provider)}/config`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      },
    ),
  setupMemoryProvider: (provider: string, values: Record<string, unknown> = {}) =>
    fetchJSON<MemoryProviderSetupResponse>(
      `/api/memory/providers/${encodeURIComponent(provider)}/setup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      },
    ),
  setMemoryProvider: (provider: string) =>
    fetchJSON<{ ok: boolean; active: string }>("/api/memory/provider", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    }),
  resetMemory: (target: "all" | "memory" | "user") =>
    fetchJSON<{ ok: boolean; deleted: string[] }>("/api/memory/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    }),

  // ── Admin: Gateway lifecycle ────────────────────────────────────────
  startGateway: () =>
    fetchJSON<ActionResponse>("/api/gateway/start", { method: "POST" }),
  stopGateway: () =>
    fetchJSON<ActionResponse>("/api/gateway/stop", { method: "POST" }),

  // ── Admin: Operations ───────────────────────────────────────────────
  runDoctor: () =>
    fetchJSON<ActionResponse>("/api/ops/doctor", { method: "POST" }),
  runSecurityAudit: () =>
    fetchJSON<ActionResponse>("/api/ops/security-audit", { method: "POST" }),
  runBackup: (output?: string) =>
    fetchJSON<ActionResponse>("/api/ops/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output }),
    }),
  downloadBackup: (archive: string) =>
    authedFetch(
      `/api/ops/backup/download?archive=${encodeURIComponent(archive)}`,
    ),
  runImport: (archive: string, force = false) =>
    fetchJSON<ActionResponse>("/api/ops/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive, force }),
    }),
  runImportUpload: (file: File, force = false) => {
    const form = new FormData();
    form.append("force", String(force));
    form.append("file", file, file.name);
    return fetchJSON<ActionResponse>("/api/ops/import-upload", {
      method: "POST",
      body: form,
    });
  },
  getHooks: () => fetchJSON<HooksResponse>("/api/ops/hooks"),
  createHook: (body: HookCreate) =>
    fetchJSON<{ ok: boolean; event: string; command: string; approved: boolean }>(
      "/api/ops/hooks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  deleteHook: (event: string, command: string) =>
    fetchJSON<{ ok: boolean }>("/api/ops/hooks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, command }),
    }),
  getSystemStats: () => fetchJSON<SystemStats>("/api/system/stats"),

  // ── Admin: Curator ──────────────────────────────────────────────────
  getCurator: () => fetchJSON<CuratorStatus>("/api/curator"),
  setCuratorPaused: (paused: boolean) =>
    fetchJSON<{ ok: boolean; paused: boolean }>("/api/curator/paused", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused }),
    }),
  runCurator: () =>
    fetchJSON<ActionResponse>("/api/curator/run", { method: "POST" }),

  // ── Admin: Portal ───────────────────────────────────────────────────
  getPortal: () => fetchJSON<PortalStatus>("/api/portal"),

  // ── Admin: Diagnostics (backgrounded) ───────────────────────────────
  runPromptSize: () =>
    fetchJSON<ActionResponse>("/api/ops/prompt-size", { method: "POST" }),
  runDump: () => fetchJSON<ActionResponse>("/api/ops/dump", { method: "POST" }),
  runConfigMigrate: () =>
    fetchJSON<ActionResponse>("/api/ops/config-migrate", { method: "POST" }),
  runDebugShare: (opts?: { redact?: boolean; lines?: number }) =>
    fetchJSON<DebugShareResponse>("/api/ops/debug-share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redact: opts?.redact ?? true,
        lines: opts?.lines ?? 200,
      }),
    }),


  getCheckpoints: () => fetchJSON<CheckpointsResponse>("/api/ops/checkpoints"),
  pruneCheckpoints: () =>
    fetchJSON<ActionResponse>("/api/ops/checkpoints/prune", { method: "POST" }),

  // ── Admin: Skills hub ───────────────────────────────────────────────
  // ``profile`` scopes install/uninstall/update and the installed-state
  // annotations to that profile (omitted = the dashboard's own profile).
  installSkillFromHub: (identifier: string, profile?: string) =>
    fetchJSON<ActionResponse>("/api/skills/hub/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, profile: profile || undefined }),
    }),
  uninstallSkillFromHub: (name: string, profile?: string) =>
    fetchJSON<ActionResponse>("/api/skills/hub/uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, profile: profile || undefined }),
    }),
  updateSkillsFromHub: (profile?: string) =>
    fetchJSON<ActionResponse>("/api/skills/hub/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: profile || undefined }),
    }),
  searchSkillsHub: (q: string, source = "all", limit = 20, profile?: string) =>
    fetchJSON<SkillHubSearchResponse>(
      `/api/skills/hub/search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}&limit=${limit}${profile ? `&profile=${encodeURIComponent(profile)}` : ""}`,
    ),
  getSkillHubSources: (profile?: string) =>
    fetchJSON<SkillHubSourcesResponse>(
      `/api/skills/hub/sources${profileQuery(profile)}`,
    ),
  previewSkillFromHub: (identifier: string) =>
    fetchJSON<SkillHubPreview>(
      `/api/skills/hub/preview?identifier=${encodeURIComponent(identifier)}`,
    ),
  scanSkillFromHub: (identifier: string) =>
    fetchJSON<SkillHubScan>(
      `/api/skills/hub/scan?identifier=${encodeURIComponent(identifier)}`,
    ),
  }
}
