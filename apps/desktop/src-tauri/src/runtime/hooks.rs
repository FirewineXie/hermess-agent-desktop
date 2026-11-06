use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn text_field<'a>(payload: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let text = payload
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if text.is_empty() || text.len() > max || text.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(text)
}

fn hook_body(payload: &Value, create: bool) -> Result<Value, DesktopFailure> {
    let event = text_field(payload, "event", 100)?;
    let command = text_field(payload, "command", 4096)?;
    if !create {
        return Ok(json!({"event":event,"command":command}));
    }
    let matcher = payload.get("matcher").filter(|value| !value.is_null());
    let matcher = match matcher {
        Some(Value::String(text)) if text.len() <= 500 && !text.chars().any(char::is_control) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_owned())
        }
        None => None,
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let timeout = payload.get("timeout").filter(|value| !value.is_null());
    if timeout.is_some_and(|value| {
        !value
            .as_u64()
            .is_some_and(|number| number > 0 && number <= 3600)
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let approve = payload
        .get("approve")
        .and_then(Value::as_bool)
        .ok_or_else(DesktopFailure::invalid_input)?;
    Ok(
        json!({"event":event,"command":command,"matcher":matcher,"timeout":timeout,"approve":approve}),
    )
}

fn hooks_path(port: u16, profile: &str) -> Result<String, DesktopFailure> {
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}/api/ops/hooks"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.query_pairs_mut().append_pair("profile", profile);
    Ok(format!("{}?{}", url.path(), url.query().unwrap_or("")))
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    if payload
        .get("profile")
        .and_then(Value::as_str)
        .is_some_and(|value| value != scope.profile)
    {
        return Err(DesktopFailure::conflict());
    }
    let method = match operation {
        "hooks.list" => Method::GET,
        "hooks.create" => Method::POST,
        "hooks.delete" => Method::DELETE,
        _ => return Err(DesktopFailure::invalid_input()),
    };
    scope.ensure_current(state).await?;
    let (port, _, _) = scope.http_auth().await?;
    let path = hooks_path(port, &scope.profile)?;
    if method == Method::GET {
        let result = config_request_for_scope(state, scope, method, &path, None).await?;
        if !result.get("hooks").is_some_and(Value::is_array)
            || !result.get("valid_events").is_some_and(Value::is_array)
        {
            return Err(DesktopFailure::operation_failed());
        }
        return Ok(result);
    }
    let body = hook_body(payload, method == Method::POST)?;
    let operation_id = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "hook_change operation={operation_id} action={operation} profile={} phase=start",
            scope.profile
        ),
    );
    let result = config_request_for_scope(state, scope, method, &path, Some(body))
        .await
        .and_then(|value| {
            if value.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(value)
            } else {
                Err(DesktopFailure::operation_failed())
            }
        });
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "hook_change operation={operation_id} action={operation} profile={} status={}",
            scope.profile,
            if result.is_ok() { "ok" } else { "failed" }
        ),
    );
    result
}

#[cfg(test)]
#[path = "tests/hooks.rs"]
mod tests;
