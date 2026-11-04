use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn required<'a>(payload: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?
        .trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn request_shape(
    profile: &str,
    operation: &str,
    payload: &Value,
) -> Result<(Method, String, Option<Value>), DesktopFailure> {
    let query = format!("?profile={profile}");
    let shape = match operation {
        "pairing.list" => (Method::GET, format!("/api/pairing{query}"), None),
        "pairing.approve" => (
            Method::POST,
            "/api/pairing/approve".into(),
            Some(json!({
                "profile": profile,
                "platform": required(payload, "platform", 64)?,
                "request_id": required(payload, "request_id", 128)?,
            })),
        ),
        "pairing.revoke" => (
            Method::POST,
            "/api/pairing/revoke".into(),
            Some(json!({
                "profile": profile,
                "platform": required(payload, "platform", 64)?,
                "user_id": required(payload, "user_id", 512)?,
            })),
        ),
        "pairing.clearPending" => (
            Method::POST,
            format!("/api/pairing/clear-pending{query}"),
            None,
        ),
        _ => return Err(DesktopFailure::invalid_input()),
    };
    Ok(shape)
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let (method, path, body) = request_shape(&scope.profile, operation, payload)?;
    let id = (method != Method::GET).then(Uuid::new_v4);
    if let Some(id) = id {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "pairing operation={id} phase=start action={operation} profile={}",
                scope.profile
            ),
        );
    }
    let result = config_request_for_scope(state, scope, method, &path, body).await;
    if let Some(id) = id {
        let status = if result.is_ok() {
            "completed"
        } else {
            "failed"
        };
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "pairing operation={id} phase=finish action={operation} profile={} status={status}",
                scope.profile
            ),
        );
    }
    result
}

#[cfg(test)]
#[path = "tests/pairing.rs"]
mod tests;
