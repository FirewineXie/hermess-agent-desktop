// Generated from schema/desktop-failure.schema.json. Run pnpm generate:contracts.
export type DesktopFailure = {
  kind: "desktop_failure"
  code: "operation_failed" | "runtime_unavailable" | "connection_lost" | "timeout" | "conflict" | "invalid_input" | "pairing_not_found" | "pairing_locked" | "session_owner_unknown" | "session_profile_mismatch"
  category: "operation" | "runtime" | "connection" | "validation"
}
