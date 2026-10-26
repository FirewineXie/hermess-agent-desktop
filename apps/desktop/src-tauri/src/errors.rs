use serde::Serialize;

#[derive(Debug, Serialize)]
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
}

impl From<String> for DesktopFailure {
    fn from(_: String) -> Self {
        Self::operation_failed()
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
