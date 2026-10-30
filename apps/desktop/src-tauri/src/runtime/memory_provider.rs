use super::{config::config_request_to_profile, BackendState};
use crate::errors::DesktopFailure;
use serde_json::{json, Map, Value};
use tauri::State;

fn provider_path(provider: &str, suffix: &str) -> Result<String, DesktopFailure> {
    if provider.is_empty()
        || provider.len() > 64
        || !provider.as_bytes()[0].is_ascii_alphanumeric()
        || !provider
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(format!("/api/memory/providers/{provider}/{suffix}"))
}

fn safe_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(512)
        .collect()
}

fn project_providers(raw: Value) -> Result<Value, DesktopFailure> {
    let rows = raw
        .get("providers")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let providers: Vec<Value> = rows
        .iter()
        .filter_map(|row| {
            let name = safe_text(row, "name");
            provider_path(&name, "config").ok()?;
            Some(
                json!({ "name": name, "description": safe_text(row, "description"),
            "available": row.get("available").and_then(Value::as_bool).unwrap_or(false),
            "configured": row.get("configured").and_then(Value::as_bool).unwrap_or(false),
            "status": safe_text(row, "status") }),
            )
        })
        .collect();
    Ok(json!({ "active": safe_text(&raw, "active"), "providers": providers }))
}

fn project_config(raw: Value) -> Result<Value, DesktopFailure> {
    let rows = raw
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let fields: Vec<Value> = rows.iter().filter_map(|field| {
        let kind = match field.get("kind")?.as_str()? {
            "boolean" => "bool",
            "integer" => "number",
            other => other,
        };
        if !["bool", "json", "number", "secret", "select", "text"].contains(&kind) { return None; }
        let key = safe_text(field, "key");
        if key.is_empty() { return None; }
        let options: Vec<Value> = field.get("options").and_then(Value::as_array).into_iter().flatten()
            .map(|option| json!({ "value": safe_text(option, "value"), "label": safe_text(option, "label") })).collect();
        Some(json!({ "key": key, "label": safe_text(field, "label"), "kind": kind,
            "description": safe_text(field, "description"), "placeholder": safe_text(field, "placeholder"),
            "group": safe_text(field, "group"), "is_set": field.get("is_set").and_then(Value::as_bool).unwrap_or(false),
            "value": if kind == "secret" { String::new() } else { match field.get("value") { Some(Value::String(value)) => value.chars().take(65536).collect(), Some(Value::Null) | None => String::new(), Some(value) => value.to_string() } }, "options": options }))
    }).collect();
    Ok(
        json!({ "name": safe_text(&raw, "name"), "label": safe_text(&raw, "label"), "fields": fields }),
    )
}

async fn config_with_surface(
    state: &State<'_, BackendState>,
    profile: &str,
    provider: &str,
) -> Result<(Value, String), DesktopFailure> {
    let base = provider_path(provider, "config")?;
    let declared_path = format!("{base}?surface=declared");
    let declared =
        config_request_to_profile(state, profile, reqwest::Method::GET, &declared_path, None)
            .await?;
    if declared
        .get("fields")
        .and_then(Value::as_array)
        .is_some_and(|fields| !fields.is_empty())
    {
        return Ok((project_config(declared)?, declared_path));
    }
    let native =
        config_request_to_profile(state, profile, reqwest::Method::GET, &base, None).await?;
    Ok((project_config(native)?, base))
}

fn project_oauth(raw: Value) -> Result<Value, DesktopFailure> {
    let state = raw
        .get("state")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?;
    if !["idle", "pending", "connected", "error"].contains(&state) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(
        json!({ "state": state, "connected": raw.get("connected").and_then(Value::as_bool).unwrap_or(state == "connected") }),
    )
}

#[tauri::command]
pub async fn get_memory_providers(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    project_providers(
        config_request_to_profile(&state, &profile, reqwest::Method::GET, "/api/memory", None)
            .await?,
    )
}

#[tauri::command]
pub async fn get_memory_provider_config(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<Value, DesktopFailure> {
    let (config, _) = config_with_surface(&state, &profile, &provider).await?;
    Ok(config)
}

#[tauri::command]
pub async fn save_memory_provider_config(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
    values: Map<String, Value>,
) -> Result<(), DesktopFailure> {
    if values.len() > 128
        || serde_json::to_vec(&values)
            .map_err(|_| DesktopFailure::invalid_input())?
            .len()
            > 65536
        || values
            .iter()
            .any(|(key, value)| key.is_empty() || key.len() > 128 || !value.is_string())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let (declared, path) = config_with_surface(&state, &profile, &provider).await?;
    let fields = declared["fields"]
        .as_array()
        .ok_or_else(DesktopFailure::operation_failed)?;
    if values
        .keys()
        .any(|key| !fields.iter().any(|field| field["key"] == key.as_str()))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let response = config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::PUT,
        &path,
        Some(json!({ "values": values })),
    )
    .await?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(())
}

#[tauri::command]
pub async fn start_memory_provider_oauth(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<Value, DesktopFailure> {
    let path = provider_path(&provider, "oauth/start")?;
    project_oauth(
        config_request_to_profile(&state, &profile, reqwest::Method::POST, &path, None).await?,
    )
}

#[tauri::command]
pub async fn get_memory_provider_oauth_status(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<Value, DesktopFailure> {
    let path = provider_path(&provider, "oauth/status")?;
    project_oauth(
        config_request_to_profile(&state, &profile, reqwest::Method::GET, &path, None).await?,
    )
}

#[cfg(test)]
#[path = "tests/memory_provider.rs"]
mod tests;
