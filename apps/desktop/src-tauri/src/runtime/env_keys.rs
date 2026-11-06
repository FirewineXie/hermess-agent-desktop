use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn key(payload: &Value) -> Result<&str, DesktopFailure> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if key.is_empty() || key.len() > 128 {
        return Err(DesktopFailure::invalid_input());
    }
    let mut bytes = key.bytes();
    if !bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        || !bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(key)
}

fn request_shape(
    profile: &str,
    operation: &str,
    payload: &Value,
) -> Result<(Method, String, Option<Value>), DesktopFailure> {
    let query = format!("?profile={profile}");
    match operation {
        "envKeys.list" => Ok((Method::GET, format!("/api/env{query}"), None)),
        "envKeys.save" => {
            let value = payload
                .get("value")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::invalid_input)?;
            if value.is_empty() || value.len() > 65536 || value.contains('\0') {
                return Err(DesktopFailure::invalid_input());
            }
            Ok((
                Method::PUT,
                "/api/env".into(),
                Some(json!({
                    "profile": profile, "key": key(payload)?, "value": value,
                })),
            ))
        }
        "envKeys.delete" => Ok((
            Method::DELETE,
            "/api/env".into(),
            Some(json!({
                "profile": profile, "key": key(payload)?,
            })),
        )),
        "envKeys.reveal" => Ok((
            Method::POST,
            "/api/env/reveal".into(),
            Some(json!({
                "profile": profile, "key": key(payload)?,
            })),
        )),
        _ => Err(DesktopFailure::invalid_input()),
    }
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let (method, path, body) = request_shape(&scope.profile, operation, payload)?;
    let id = (operation != "envKeys.list").then(Uuid::new_v4);
    if let Some(id) = id {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "env_keys operation={id} phase=start action={operation} profile={}",
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
            &format!("env_keys operation={id} phase=finish action={operation} profile={} status={status}", scope.profile),
        );
    }
    result
}

#[cfg(test)]
#[path = "tests/env_keys.rs"]
mod tests;
