// @ts-nocheck
// Synchronized from locked Hermes Dashboard web/src/lib/api.ts.
export function createDashboardPluginCoreApi(runtime: any) {
  const { fetchJSON, authedFetch, buildWsUrl, getManagementProfile, appendProfileParam, appendQueryParam, profileQuery, normalizeSessionQueryOptions, appendSessionFilters, mutateSessionHttp } = runtime
  return {
  getStatus: () => fetchJSON<StatusResponse>("/api/status"),
  /**
   * Identity probe for the dashboard auth gate (Phase 7).
   *
   * Returns the verified Session when gated mode is active. In loopback mode,
   * a valid injected session token returns a synthetic ``provider=loopback``
   * identity; AuthWidget recognizes that provider and renders nothing, so it
   * never exposes a logout action that would redirect to an unavailable login.
   *
   * ``allowUnauthorized`` remains load-bearing for a missing or stale loopback
   * token: keep that 401 local to the widget instead of triggering the global
   * rotated-token reload path.
   */
  getAuthMe: () =>
    fetchJSON<AuthMeResponse>("/api/auth/me", undefined, {
      allowUnauthorized: true,
    }),
  logout: () =>
    fetch(`${BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).then((r) => {
      // /auth/logout returns 302 → /login. Follow that with a full-page
      // navigation rather than letting fetch() opaquely consume the
      // redirect — the SPA needs to leave the protected area.
      window.location.assign(`${BASE}/login`);
      return r;
    }),
  getSessions: (
    limit = 20,
    offset = 0,
    profileOrOptions: string | SessionQueryOptions = getManagementProfile(),
    order: "created" | "recent" = "created",
  ) => {
    const options = normalizeSessionQueryOptions(profileOrOptions, order);
    return fetchJSON<PaginatedSessions>(
      appendSessionFilters(
        `/api/sessions?limit=${limit}&offset=${offset}&order=${options.order ?? order}`,
        options,
      ),
    );
  },
  getSessionMessages: (id: string, profile = getManagementProfile()) =>
    fetchJSON<SessionMessagesResponse>(
      appendProfileParam(
        `/api/sessions/${encodeURIComponent(id)}/messages?limit=500&order=latest`,
        profile,
      ),
    ),
  getSessionDetail: (id: string, profile = getManagementProfile()) =>
    fetchJSON<SessionInfo>(
      appendProfileParam(`/api/sessions/${encodeURIComponent(id)}`, profile),
    ),
  /**
   * Directories a FRESH dashboard chat may start in: the profile's explicit
   * projects plus discovered git repos (session-derived + scanned). ``scan``
   * asks the host to rescan its discovery roots first (headless installs have
   * no Desktop to populate the cache).
   */
  getChatWorkspaces: (profile = getManagementProfile(), scan = false) =>
    fetchJSON<ChatWorkspacesResponse>(
      appendQueryParam(
        appendProfileParam("/api/chat/workspaces", profile),
        "scan",
        scan ? "1" : undefined,
      ),
    ),
  getSessionLatestDescendant: (id: string, profile = getManagementProfile()) =>
    fetchJSON<SessionLatestDescendantResponse>(
      appendProfileParam(
        `/api/sessions/${encodeURIComponent(id)}/latest-descendant`,
        profile,
      ),
    ),
  deleteSession: (id: string, profile = getManagementProfile()) =>
    mutateSessionHttp<{ ok: boolean }>(id, "DELETE", {}, profile),
  getEmptySessionsCount: (profile = getManagementProfile()) =>
    fetchJSON<{ count: number }>(
      appendProfileParam("/api/sessions/empty/count", profile),
    ),
  deleteEmptySessions: (profile = getManagementProfile()) =>
    fetchJSON<{ ok: boolean; deleted: number }>(
      appendProfileParam("/api/sessions/empty", profile),
      {
        method: "DELETE",
      },
    ),
  bulkDeleteSessions: (ids: string[], profile = getManagementProfile()) =>
    fetchJSON<{ ok: boolean; deleted: number; skipped_active?: string[] }>("/api/sessions/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, profile: profile || undefined }),
    }),
  renameSession: (id: string, title: string, profile = getManagementProfile()) =>
    mutateSessionHttp<{ ok: boolean; title: string }>(id, "PATCH", { title }, profile),
  getSessionStats: (profile = getManagementProfile()) =>
    fetchJSON<SessionStoreStats>(appendProfileParam("/api/sessions/stats", profile)),
  exportSessionUrl: (id: string, profile = getManagementProfile()) =>
    appendProfileParam(`/api/sessions/${encodeURIComponent(id)}/export`, profile),
  importSessions: (
    sessions: Array<Record<string, unknown>>,
    profile = getManagementProfile(),
  ) => {
    const id = sessions[0]?.id;
    if (typeof id !== "string" || !id) return Promise.reject(new Error("session id is required"));
    return mutateSessionHttp<SessionImportResponse>(id, "POST", { sessions }, profile);
  },
  pruneSessions: (
    older_than_days: number,
    source?: string,
    profile = getManagementProfile(),
  ) =>
    fetchJSON<{ ok: boolean; removed: number; skipped_open: number }>(
      "/api/sessions/prune",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          older_than_days,
          source,
          profile: profile || undefined,
        }),
      },
    ),
  listFiles: (path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return fetchJSON<ManagedFilesResponse>(`/api/files${query}`);
  },
  readFile: (path: string) =>
    fetchJSON<ManagedFileReadResponse>(
      `/api/files/read?path=${encodeURIComponent(path)}`,
    ),
  uploadFile: (path: string, file: File, overwrite = true) => {
    // Stream the raw bytes as multipart/form-data. Do NOT set Content-Type —
    // the browser adds the multipart boundary automatically. Sending the file
    // as base64 JSON (the old path) inflated the body ~33%, buffered the whole
    // file in memory, and 502'd on large backup archives behind the proxy
    // (NS-501).
    const form = new FormData();
    form.append("path", path);
    form.append("overwrite", String(overwrite));
    form.append("file", file, file.name);
    return fetchJSON<ManagedFileWriteResponse>("/api/files/upload-stream", {
      method: "POST",
      body: form,
    });
  },
  createDirectory: (path: string) =>
    fetchJSON<ManagedFileWriteResponse>("/api/files/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  deleteFile: (path: string, recursive = false) =>
    fetchJSON<{ ok: boolean; path: string }>("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, recursive }),
    }),
  getLogs: (params: { file?: string; lines?: number; level?: string; component?: string }) => {
    const qs = new URLSearchParams();
    if (params.file) qs.set("file", params.file);
    if (params.lines) qs.set("lines", String(params.lines));
    if (params.level && params.level !== "ALL") qs.set("level", params.level);
    if (params.component && params.component !== "all") qs.set("component", params.component);
    return fetchJSON<LogsResponse>(`/api/logs?${qs.toString()}`);
  },
  getAnalytics: (days: number, profile = getManagementProfile()) =>
    fetchJSON<AnalyticsResponse>(
      appendProfileParam(`/api/analytics/usage?days=${days}`, profile),
    ),
  getModelsAnalytics: (days: number, profile = getManagementProfile()) =>
    fetchJSON<ModelsAnalyticsResponse>(
      appendProfileParam(`/api/analytics/models?days=${days}`, profile),
    ),
  getConfig: (profile = getManagementProfile()) =>
    fetchJSON<Record<string, unknown>>(appendProfileParam("/api/config", profile)),
  getDefaults: () => fetchJSON<Record<string, unknown>>("/api/config/defaults"),
  getSchema: () => fetchJSON<{ fields: Record<string, unknown>; category_order: string[] }>("/api/config/schema"),
  getModelInfo: (profile = getManagementProfile()) =>
    fetchJSON<ModelInfoResponse>(appendProfileParam("/api/model/info", profile)),
  getModelOptions: (
    profileOrOptions?: string | { profile?: string; refresh?: boolean },
  ) => {
    const profile =
      typeof profileOrOptions === "string"
        ? profileOrOptions
        : profileOrOptions?.profile;
    const refresh =
      typeof profileOrOptions === "object" && !!profileOrOptions.refresh;
    const qs = new URLSearchParams();
    if (profile) qs.set("profile", profile);
    if (refresh) qs.set("refresh", "1");
    // Dashboard surfaces (Models page, profile builder, cron) are
    // management/setup UIs: keep the full provider universe with setup
    // affordances. The endpoint now defaults to the configured subset for
    // desktop chat pickers (#56974), so opt in explicitly here.
    qs.set("include_unconfigured", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetchJSON<ModelOptionsResult>(`/api/model/options${suffix}`);
  },
  getAuxiliaryModels: (profile = getManagementProfile()) =>
    fetchJSON<AuxiliaryModelsResponse>(
      appendProfileParam("/api/model/auxiliary", profile),
    ),
  getMoaModels: () => fetchJSON<MoaConfigResponse>("/api/model/moa"),
  saveMoaModels: (body: MoaConfigResponse) =>
    fetchJSON<MoaConfigResponse & { ok: boolean }>("/api/model/moa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  setModelAssignment: (
    body: ModelAssignmentRequest,
    profile = getManagementProfile(),
  ) =>
    fetchJSON<ModelAssignmentResponse>(
      appendProfileParam("/api/model/set", profile),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  getSharedMetricsConsent: (profile = getManagementProfile()) =>
    fetchJSON<SharedMetricsConsent>(appendProfileParam("/api/shared-metrics/consent", profile)),
  saveSharedMetricsConsent: (answer: { enabled: boolean; send: boolean }, profile = getManagementProfile()) =>
    fetchJSON<SharedMetricsConsent>(appendProfileParam("/api/shared-metrics/consent", profile), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answer),
    }),
  saveConfig: (config: Record<string, unknown>, profile = getManagementProfile()) =>
    fetchJSON<{ ok: boolean }>(appendProfileParam("/api/config", profile), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    }),
  getConfigRaw: (profile = getManagementProfile()) =>
    fetchJSON<{ yaml: string; path?: string }>(
      appendProfileParam("/api/config/raw", profile),
    ),
  saveConfigRaw: (yaml_text: string, profile = getManagementProfile()) =>
    fetchJSON<{ ok: boolean }>(appendProfileParam("/api/config/raw", profile), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml_text }),
    }),
  getEnvVars: () => fetchJSON<Record<string, EnvVarInfo>>("/api/env"),
  setEnvVar: (key: string, value: string) =>
    fetchJSON<{ ok: boolean }>("/api/env", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }),
  deleteEnvVar: (key: string) =>
    fetchJSON<{ ok: boolean }>("/api/env", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }),
  revealEnvVar: (key: string) =>
    fetchJSON<{ key: string; value: string }>("/api/env/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }),

  // Cron jobs
  getCronJobs: (profile = "all") =>
    fetchJSON<CronJob[]>(`/api/cron/jobs?profile=${encodeURIComponent(profile)}`),
  getCronDeliveryTargets: (profile = "default") =>
    fetchJSON<{ targets: CronDeliveryTarget[] }>(
      `/api/cron/delivery-targets?profile=${encodeURIComponent(profile)}`,
    ),
  createCronJob: (job: CronJobMutation, profile = "default") =>
    fetchJSON<CronJob>(`/api/cron/jobs?profile=${encodeURIComponent(profile)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    }),
  pauseCronJob: (id: string, profile = "default") =>
    fetchJSON<CronJob>(`/api/cron/jobs/${encodeURIComponent(id)}/pause?profile=${encodeURIComponent(profile)}`, { method: "POST" }),
  updateCronJob: (
    id: string,
    updates: CronJobMutation,
    profile = "default",
  ) =>
    fetchJSON<CronJob>(
      `/api/cron/jobs/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      },
    ),
  resumeCronJob: (id: string, profile = "default") =>
    fetchJSON<CronJob>(`/api/cron/jobs/${encodeURIComponent(id)}/resume?profile=${encodeURIComponent(profile)}`, { method: "POST" }),
  triggerCronJob: (id: string, profile = "default") =>
    fetchJSON<CronJob>(`/api/cron/jobs/${encodeURIComponent(id)}/trigger?profile=${encodeURIComponent(profile)}`, { method: "POST" }),
  deleteCronJob: (id: string, profile = "default") =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`, { method: "DELETE" }),

  // Automation Blueprints — parameterized automation blueprints
  getAutomationBlueprints: (profile = "default") =>
    fetchJSON<{ blueprints: AutomationBlueprint[] }>(
      `/api/cron/blueprints?profile=${encodeURIComponent(profile)}`,
    ),
  instantiateAutomationBlueprint: (
    body: { blueprint: string; values: Record<string, string> },
    profile = "default",
  ) =>
    fetchJSON<CronJob>(`/api/cron/blueprints/instantiate?profile=${encodeURIComponent(profile)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  // Profiles
  getProfiles: () =>
    fetchJSON<{ profiles: ProfileInfo[] }>("/api/profiles"),
  getActiveProfile: () =>
    fetchJSON<ActiveProfileInfo>("/api/profiles/active"),
  setActiveProfile: (name: string) =>
    fetchJSON<{ ok: boolean; active: string }>("/api/profiles/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  createProfile: (body: {
    name: string;
    clone_from?: string | null;
    clone_from_default?: boolean;
    clone_all?: boolean;
    no_skills?: boolean;
    description?: string;
    provider?: string;
    model?: string;
    mcp_servers?: McpServerCreate[];
    keep_skills?: string[];
    hub_skills?: string[];
  }) =>
    fetchJSON<{
      ok: boolean;
      name: string;
      path: string;
      model_set?: boolean;
      mcp_written?: number;
      skills_disabled?: number;
      hub_installs?: Array<{ identifier: string; pid: number | null }>;
    }>("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateProfileDescription: (name: string, description: string) =>
    fetchJSON<{ ok: boolean; description: string; description_auto: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}/description`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      },
    ),
  describeProfileAuto: (name: string, overwrite = true) =>
    fetchJSON<ProfileDescribeAutoResult>(
      `/api/profiles/${encodeURIComponent(name)}/describe-auto`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite }),
      },
    ),
  setProfileModel: (name: string, provider: string, model: string) =>
    fetchJSON<{ ok: boolean; provider: string; model: string }>(
      `/api/profiles/${encodeURIComponent(name)}/model`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      },
    ),
  renameProfile: (name: string, newName: string) =>
    fetchJSON<{ ok: boolean; name: string; path: string }>(
      `/api/profiles/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: newName }),
      },
    ),
  deleteProfile: (name: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  getProfileSetupCommand: (name: string) =>
    fetchJSON<{ command: string }>(
      `/api/profiles/${encodeURIComponent(name)}/setup-command`,
    ),
  getProfileSoul: (name: string) =>
    fetchJSON<{ content: string; exists: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}/soul`,
    ),
  updateProfileSoul: (name: string, content: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}/soul`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    ),

  // Skills & Toolsets
  //
  // All calls accept an optional ``profile`` so the Skills page can manage
  // any profile's skills/toolsets — not just the one the dashboard process
  // runs under. Omitted/empty profile = the dashboard's own profile.
  getSkills: (profile?: string) =>
    fetchJSON<SkillInfo[]>(`/api/skills${profileQuery(profile)}`),
  toggleSkill: (name: string, enabled: boolean, profile?: string) =>
    fetchJSON<{ ok: boolean }>("/api/skills/toggle", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, enabled, profile: profile || undefined }),
    }),
  getSkillContent: (name: string, profile?: string) =>
    fetchJSON<SkillContent>(
      `/api/skills/content?name=${encodeURIComponent(name)}${profile ? `&profile=${encodeURIComponent(profile)}` : ""}`,
    ),
  createSkill: (skill: { name: string; content: string; category?: string }, profile?: string) =>
    fetchJSON<SkillWriteResult>("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...skill, profile: profile || undefined }),
    }),
  updateSkillContent: (name: string, content: string, profile?: string) =>
    fetchJSON<SkillWriteResult>("/api/skills/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content, profile: profile || undefined }),
    }),
  getToolsets: (profile?: string) =>
    fetchJSON<ToolsetInfo[]>(`/api/tools/toolsets${profileQuery(profile)}`),
  toggleToolset: (name: string, enabled: boolean, profile?: string) =>
    fetchJSON<{ ok: boolean; name: string; platform: string; enabled: boolean }>(
      `/api/tools/toolsets/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, profile: profile || undefined }),
      },
    ),
  getToolsetConfig: (name: string, profile?: string) =>
    fetchJSON<ToolsetConfig>(
      `/api/tools/toolsets/${encodeURIComponent(name)}/config${profileQuery(profile)}`,
    ),
  selectToolsetProvider: (name: string, provider: string, profile?: string) =>
    fetchJSON<{ ok: boolean; name: string; provider: string }>(
      `/api/tools/toolsets/${encodeURIComponent(name)}/provider`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, profile: profile || undefined }),
      },
    ),
  saveToolsetEnv: (name: string, env: Record<string, string>, profile?: string) =>
    fetchJSON<ToolsetEnvResult>(
      `/api/tools/toolsets/${encodeURIComponent(name)}/env`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, profile: profile || undefined }),
      },
    ),
  runToolsetPostSetup: (name: string, key: string, profile?: string) =>
    fetchJSON<ActionResponse & { key: string }>(
      `/api/tools/toolsets/${encodeURIComponent(name)}/post-setup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, profile: profile || undefined }),
      },
    ),

  // Session search (FTS5)
  searchSessions: (
    q: string,
    profileOrOptions: string | SessionQueryOptions = getManagementProfile(),
  ) => {
    const options = normalizeSessionQueryOptions(profileOrOptions);
    return fetchJSON<SessionSearchResponse>(
      appendSessionFilters(
        `/api/sessions/search?q=${encodeURIComponent(q)}`,
        options,
      ),
    );
  },

  // OAuth provider management
  getOAuthProviders: () =>
    fetchJSON<OAuthProvidersResponse>("/api/providers/oauth"),
  disconnectOAuthProvider: (providerId: string) =>
    fetchJSON<{ ok: boolean; provider: string }>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}`,
      {
        method: "DELETE",
      },
    ),
  startOAuthLogin: (providerId: string) =>
    fetchJSON<OAuthStartResponse>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    ),
  submitOAuthCode: (providerId: string, sessionId: string, code: string) =>
    fetchJSON<OAuthSubmitResponse>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, code }),
      },
    ),
  pollOAuthSession: (providerId: string, sessionId: string) =>
    fetchJSON<OAuthPollResponse>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}`,
    ),
  cancelOAuthSession: (sessionId: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
      },
    ),

  // Messaging platforms (gateway channels)
  getMessagingPlatforms: () =>
    fetchJSON<MessagingPlatformsResponse>("/api/messaging/platforms"),
  // `hot_served`: a live multiplexer serving the selected named profile rebuilt its adapters from the
  // new credentials right away (no gateway restart needed).
  updateMessagingPlatform: (id: string, body: MessagingPlatformUpdate) =>
    fetchJSON<{ ok: boolean; platform: string; hot_served?: boolean }>(
      `/api/messaging/platforms/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  testMessagingPlatform: (id: string) =>
    fetchJSON<MessagingPlatformTestResult>(
      `/api/messaging/platforms/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
  startTelegramOnboarding: (body: { bot_name?: string }) =>
    fetchJSON<TelegramOnboardingStartResponse>(
      "/api/messaging/telegram/onboarding/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  getTelegramOnboardingStatus: (pairingId: string) =>
    fetchJSON<TelegramOnboardingStatusResponse>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`,
    ),
  applyTelegramOnboarding: (
    pairingId: string,
    body: { allowed_user_ids: string[]; profile?: string },
  ) =>
    fetchJSON<TelegramOnboardingApplyResponse>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  cancelTelegramOnboarding: (pairingId: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`,
      { method: "DELETE" },
    ),
  startWhatsAppOnboarding: (body: WhatsAppOnboardingStartRequest) =>
    fetchJSON<WhatsAppOnboardingStartResponse>(
      "/api/messaging/whatsapp/onboarding/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  getWhatsAppOnboardingStatus: (pairingId: string) =>
    fetchJSON<WhatsAppOnboardingStatusResponse>(
      `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`,
    ),
  applyWhatsAppOnboarding: (
    pairingId: string,
    body: { mode?: "bot" | "self-chat"; allowed_users?: string; profile?: string },
  ) =>
    fetchJSON<WhatsAppOnboardingApplyResponse>(
      `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  cancelWhatsAppOnboarding: (pairingId: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`,
      { method: "DELETE" },
    ),

  // Gateway / update actions
  restartGateway: () =>
    fetchJSON<ActionResponse>("/api/gateway/restart", { method: "POST" }),
  getGatewayMigratePlan: () =>
    fetchJSON<GatewayMigratePlan>("/api/gateway/migrate/plan"),
  migrateGatewayToMultiplex: () =>
    fetchJSON<ActionResponse>("/api/gateway/migrate", { method: "POST" }),
  updateHermes: () =>
    fetchJSON<ActionResponse>("/api/hermes/update", { method: "POST" }),
  checkHermesUpdate: (force = false) =>
    fetchJSON<UpdateCheckResponse>(
      `/api/hermes/update/check${force ? "?force=true" : ""}`,
    ),
  getActionStatus: (name: string, lines = 200) =>
    fetchJSON<ActionStatusResponse>(
      `/api/actions/${encodeURIComponent(name)}/status?lines=${lines}`,
    ),

  }
}
