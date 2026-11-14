// Generated from schema/desktop-failure.schema.json. Run pnpm generate:contracts.
export type DesktopFailure = {
  kind: "desktop_failure"
  code: "operation_failed" | "runtime_unavailable" | "connection_lost" | "timeout" | "conflict" | "invalid_input" | "pairing_not_found" | "pairing_locked" | "session_owner_unknown" | "session_profile_mismatch" | "session_superseded" | "web_access_address" | "web_access_tls" | "web_access_bind" | "web_access_settings" | "web_access_link" | "web_access_restart_deferred" | "web_access_managed_policy"
  category: "operation" | "runtime" | "connection" | "validation"
}
