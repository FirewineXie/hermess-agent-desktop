use serde::Serialize;

pub const SESSION_OWNER_UNKNOWN: &str = "session_owner_unknown";
pub const SESSION_PROFILE_MISMATCH: &str = "session_profile_mismatch";

#[derive(Clone, Debug, Serialize)]
pub struct DesktopFailure {
    kind: &'static str,
    code: &'static str,
    category: &'static str,
}

impl DesktopFailure {
    fn new(code: &'static str, category: &'static str) -> Self {
        Self {
            kind: "desktop_failure",
            code,
            category,
        }
    }

    pub fn operation_failed() -> Self {
        Self::new("operation_failed", "operation")
    }

    pub fn runtime_unavailable() -> Self {
        Self::new("runtime_unavailable", "runtime")
    }

    pub fn connection_lost() -> Self {
        Self::new("connection_lost", "connection")
    }

    pub fn timeout() -> Self {
        Self::new("timeout", "connection")
    }

    pub fn conflict() -> Self {
        Self::new("conflict", "validation")
    }

    pub fn invalid_input() -> Self {
        Self::new("invalid_input", "validation")
    }

    pub fn session_owner_unknown() -> Self {
        Self::new(SESSION_OWNER_UNKNOWN, "validation")
    }

    pub fn session_profile_mismatch() -> Self {
        Self::new(SESSION_PROFILE_MISMATCH, "validation")
    }
}

impl From<String> for DesktopFailure {
    fn from(value: String) -> Self {
        match value.as_str() {
            SESSION_OWNER_UNKNOWN => Self::session_owner_unknown(),
            SESSION_PROFILE_MISMATCH => Self::session_profile_mismatch(),
            _ => Self::operation_failed(),
        }
    }
}

impl From<&str> for DesktopFailure {
    fn from(_: &str) -> Self {
        Self::operation_failed()
    }
}

#[cfg(test)]
#[path = "tests/errors.rs"]
mod tests;
