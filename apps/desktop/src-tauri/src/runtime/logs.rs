use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::Value;
use tauri::State;

fn choice<'a>(payload: &'a Value, key: &str, allowed: &[&str]) -> Result<&'a str, DesktopFailure> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if !allowed.contains(&value) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn request_path(profile: &str, payload: &Value) -> Result<String, DesktopFailure> {
    let file = choice(payload, "file", &["agent", "errors", "gateway"])?;
    let level = choice(
        payload,
        "level",
        &["ALL", "DEBUG", "INFO", "WARNING", "ERROR"],
    )?;
    let component = choice(
        payload,
        "component",
        &["all", "gateway", "agent", "tools", "cli", "cron"],
    )?;
    let lines = payload
        .get("lines")
        .and_then(Value::as_u64)
        .filter(|value| [50, 100, 200, 500].contains(value))
        .ok_or_else(DesktopFailure::invalid_input)?;
    let search = payload
        .get("search")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if search.len() > 120 || search.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut url =
        Url::parse("http://127.0.0.1/api/logs").map_err(|_| DesktopFailure::operation_failed())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("profile", profile);
        query.append_pair("file", file);
        query.append_pair("lines", &lines.to_string());
        if level != "ALL" {
            query.append_pair("level", level);
        }
        if component != "all" {
            query.append_pair("component", component);
        }
        if !search.is_empty() {
            query.append_pair("search", search);
        }
    }
    Ok(format!(
        "{}?{}",
        url.path(),
        url.query().unwrap_or_default()
    ))
}

pub(super) async fn read(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let path = request_path(&scope.profile, payload)?;
    let result = config_request_for_scope(state, scope, Method::GET, &path, None).await;
    if result.is_err() {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("logs action=read profile={} status=failed", scope.profile),
        );
    }
    result
}

#[cfg(test)]
#[path = "tests/logs.rs"]
mod tests;
