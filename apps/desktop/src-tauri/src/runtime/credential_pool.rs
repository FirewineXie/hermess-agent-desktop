use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn text<'a>(payload: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn provider(payload: &Value) -> Result<String, DesktopFailure> {
    let value = text(payload, "provider", 100)?.to_ascii_lowercase();
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_:.".contains(&byte))
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn add_body(payload: &Value) -> Result<Value, DesktopFailure> {
    let provider = provider(payload)?;
    let api_key = text(payload, "api_key", 16_384)?;
    let label = payload.get("label").filter(|value| !value.is_null());
    let label = match label {
        Some(Value::String(value))
            if value.len() <= 100 && !value.chars().any(char::is_control) =>
        {
            value.trim()
        }
        None => "",
        _ => return Err(DesktopFailure::invalid_input()),
    };
    Ok(json!({"provider":provider,"api_key":api_key,"label":label}))
}

fn pool_path(
    port: u16,
    profile: &str,
    target: Option<(&str, u64)>,
) -> Result<String, DesktopFailure> {
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}/api/credentials/pool"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if let Some((provider, index)) = target {
        url.path_segments_mut()
            .map_err(|_| DesktopFailure::operation_failed())?
            .push(provider)
            .push(&index.to_string());
    }
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
    scope.ensure_current(state).await?;
    let (port, _, _) = scope.http_auth().await?;
    match operation {
        "credentials.pool.list" => {
            let path = pool_path(port, &scope.profile, None)?;
            let result = config_request_for_scope(state, scope, Method::GET, &path, None).await?;
            if !result.get("providers").is_some_and(Value::is_array) {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(result)
        }
        "credentials.pool.add" => {
            let body = add_body(payload)?;
            let path = pool_path(port, &scope.profile, None)?;
            write_request(state, scope, operation, Method::POST, &path, Some(body)).await
        }
        "credentials.pool.delete" => {
            let provider = provider(payload)?;
            let index = payload
                .get("index")
                .and_then(Value::as_u64)
                .filter(|index| *index > 0 && *index <= 10_000)
                .ok_or_else(DesktopFailure::invalid_input)?;
            let entry_id = text(payload, "entry_id", 100)?;
            let list_path = pool_path(port, &scope.profile, None)?;
            let list =
                config_request_for_scope(state, scope, Method::GET, &list_path, None).await?;
            let owned = list
                .get("providers")
                .and_then(Value::as_array)
                .and_then(|providers| {
                    providers.iter().find(|item| {
                        item.get("provider").and_then(Value::as_str) == Some(provider.as_str())
                    })
                })
                .and_then(|item| item.get("entries").and_then(Value::as_array))
                .and_then(|entries| {
                    entries
                        .iter()
                        .find(|item| item.get("index").and_then(Value::as_u64) == Some(index))
                })
                .and_then(|item| item.get("id").and_then(Value::as_str))
                == Some(entry_id);
            if !owned {
                return Err(DesktopFailure::conflict());
            }
            let path = pool_path(port, &scope.profile, Some((&provider, index)))?;
            write_request(state, scope, operation, Method::DELETE, &path, None).await
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

async fn write_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    let operation_id = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "credential_pool operation={operation_id} action={operation} profile={} phase=start",
            scope.profile
        ),
    );
    let result = config_request_for_scope(state, scope, method, path, body)
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
            "credential_pool operation={operation_id} action={operation} profile={} status={}",
            scope.profile,
            if result.is_ok() { "ok" } else { "failed" }
        ),
    );
    result
}

#[cfg(test)]
#[path = "tests/credential_pool.rs"]
mod tests;
