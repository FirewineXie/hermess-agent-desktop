use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn name(payload: &Value) -> Result<&str, DesktopFailure> {
    let value = payload
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if value.is_empty()
        || value.len() > 64
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && (byte == b'-' || byte == b'_'))
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn optional_text<'a>(
    payload: &'a Value,
    key: &str,
    max: usize,
) -> Result<Option<&'a str>, DesktopFailure> {
    match payload.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.len() <= max => Ok(Some(value)),
        _ => Err(DesktopFailure::invalid_input()),
    }
}

fn creation_body(payload: &Value) -> Result<Value, DesktopFailure> {
    let route_name = name(payload)?;
    let deliver = optional_text(payload, "deliver", 32)?.unwrap_or("log");
    if !matches!(
        deliver,
        "log" | "telegram" | "discord" | "slack" | "email" | "github_comment"
    ) {
        return Err(DesktopFailure::invalid_input());
    }
    let deliver_only = payload
        .get("deliver_only")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if deliver_only && deliver == "log" {
        return Err(DesktopFailure::invalid_input());
    }
    let events = payload
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if events.len() > 32
        || events
            .iter()
            .any(|value| !value.as_str().is_some_and(|event| event.len() <= 128))
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(json!({
        "name": route_name,
        "description": optional_text(payload, "description", 1024)?.unwrap_or(""),
        "events": events,
        "deliver": deliver,
        "deliver_only": deliver_only,
        "prompt": optional_text(payload, "prompt", 8192)?.unwrap_or(""),
    }))
}

fn request_shape(
    profile: &str,
    operation: &str,
    payload: &Value,
) -> Result<(Method, String, Option<Value>), DesktopFailure> {
    let query = format!("?profile={profile}");
    let (method, path, body) = match operation {
        "webhooks.list" => (Method::GET, format!("/api/webhooks{query}"), None),
        "webhooks.create" => (
            Method::POST,
            format!("/api/webhooks{query}"),
            Some(creation_body(payload)?),
        ),
        "webhooks.toggle" => {
            let enabled = payload
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or_else(DesktopFailure::invalid_input)?;
            (
                Method::PUT,
                format!("/api/webhooks/{}/enabled{query}", name(payload)?),
                Some(json!({"enabled": enabled})),
            )
        }
        "webhooks.delete" => (
            Method::DELETE,
            format!("/api/webhooks/{}{query}", name(payload)?),
            None,
        ),
        _ => return Err(DesktopFailure::invalid_input()),
    };
    Ok((method, path, body))
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
                "webhooks operation={id} phase=start action={operation} profile={}",
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
        let _ = crate::diagnostics::append_client_event(&scope.storage,
            &format!("webhooks operation={id} phase=finish action={operation} profile={} status={status}", scope.profile));
    }
    result
}

#[cfg(test)]
#[path = "tests/webhooks.rs"]
mod tests;
