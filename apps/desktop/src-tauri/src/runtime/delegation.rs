use super::{config::config_request_for_scope, BackendState};
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use tauri::State;

fn public_routing(mut value: Value) -> Value {
    if let Some(rows) = value
        .pointer_mut("/model_map/options")
        .and_then(Value::as_array_mut)
    {
        for row in rows {
            if let Some(map) = row.as_object_mut() {
                let has_key = map
                    .remove("api_key")
                    .is_some_and(|key| key.as_str().is_some_and(|s| !s.is_empty()));
                map.insert("has_api_key".into(), json!(has_key));
            }
        }
    }
    value
}

pub(super) fn prepare_model_map(draft: &Value, current: &Value) -> Result<Value, DesktopFailure> {
    let mut block = draft
        .get("model_map")
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    let rows = block
        .get_mut("options")
        .and_then(Value::as_array_mut)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if rows.len() > 128 {
        return Err(DesktopFailure::invalid_input());
    }
    let mut names = std::collections::HashSet::new();
    for row in rows {
        let map = row
            .as_object_mut()
            .ok_or_else(DesktopFailure::invalid_input)?;
        for key in ["name", "description", "model"] {
            if !map
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty() && s.len() <= 4096)
            {
                return Err(DesktopFailure::invalid_input());
            }
        }
        if !names.insert(map["name"].as_str().unwrap().trim().to_owned()) {
            return Err(DesktopFailure::invalid_input());
        }
        if let Some(url) = map
            .get("base_url")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            let url = reqwest::Url::parse(url).map_err(|_| DesktopFailure::invalid_input())?;
            if !["http", "https"].contains(&url.scheme())
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.fragment().is_some()
            {
                return Err(DesktopFailure::invalid_input());
            }
        }
        if map.get("request_overrides").is_some_and(|v| !v.is_object()) {
            return Err(DesktopFailure::invalid_input());
        }
        if let Some(fallbacks) = map.get("fallback_providers") {
            let rows = fallbacks
                .as_array()
                .ok_or_else(DesktopFailure::invalid_input)?;
            if rows.iter().any(|r| {
                ["provider", "model"].iter().any(|k| {
                    !r.get(*k)
                        .and_then(Value::as_str)
                        .is_some_and(|s| !s.trim().is_empty())
                })
            }) {
                return Err(DesktopFailure::invalid_input());
            }
        }
        let original = map
            .remove("original_name")
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| map["name"].as_str().unwrap().to_owned());
        let credential = map.remove("credential").unwrap_or(json!({"action":"keep"}));
        let preserve_key = map
            .remove("has_api_key")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        map.remove("api_key");
        let key = match credential.get("action").and_then(Value::as_str) {
            Some("clear") => json!(""),
            Some("replace") => {
                let key = credential
                    .get("value")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty() && s.len() <= 8192)
                    .ok_or_else(DesktopFailure::invalid_input)?;
                json!(key)
            }
            Some("keep") if !preserve_key => json!(""),
            Some("keep") => current
                .pointer("/model_map/options")
                .and_then(Value::as_array)
                .and_then(|rows| rows.iter().find(|r| r["name"] == original))
                .and_then(|r| r.get("api_key"))
                .cloned()
                .unwrap_or(json!("")),
            _ => return Err(DesktopFailure::invalid_input()),
        };
        map.insert("original_name".into(), json!(original));
        map.insert("api_key".into(), key);
    }
    Ok(block)
}

#[tauri::command]
pub async fn get_delegation_routing(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::GET,
        "/api/delegation/routing",
        None,
    )
    .await
    .map(public_routing)
}

#[tauri::command]
pub async fn save_delegation_routing(
    state: State<'_, BackendState>,
    profile: String,
    draft: Value,
) -> Result<Value, DesktopFailure> {
    if serde_json::to_vec(&draft)
        .map_err(|_| DesktopFailure::invalid_input())?
        .len()
        > 256 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let current = config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::GET,
        "/api/delegation/routing",
        None,
    )
    .await?;
    let backend = draft["configured"]
        .as_str()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if !["default", "model_map", "profile_routes"].contains(&backend) {
        return Err(DesktopFailure::invalid_input());
    }
    if backend != "default" {
        let block = if backend == "model_map" {
            prepare_model_map(&draft, &current)?
        } else {
            draft["profile_routes"].clone()
        };
        config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::PUT,
            &format!("/api/delegation/backends/{backend}"),
            Some(block),
        )
        .await?;
    }
    let activated = config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::PUT,
        "/api/delegation/backend",
        Some(json!({"backend":backend})),
    )
    .await
    .is_ok();
    let routing = config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::GET,
        "/api/delegation/routing",
        None,
    )
    .await?;
    Ok(json!({"routing":public_routing(routing),"activated":activated}))
}

#[cfg(test)]
#[path = "tests/delegation.rs"]
mod tests;
