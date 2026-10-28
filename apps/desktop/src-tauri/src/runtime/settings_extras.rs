use super::{
    config::{config_request_to_profile, config_request_to_profile_with_limits},
    voice_direct, BackendState,
};
use crate::errors::DesktopFailure;
use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::State;

fn memory_provider_path(provider: &str, suffix: &str) -> Result<String, DesktopFailure> {
    if provider.is_empty() || provider.len() > 80 || provider.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut url = reqwest::Url::parse("http://localhost/api/memory/providers/")
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.path_segments_mut()
        .map_err(|_| DesktopFailure::operation_failed())?
        .pop_if_empty()
        .push(provider);
    let mut path = url.path().to_owned();
    path.push_str(suffix);
    Ok(path)
}

#[tauri::command]
pub async fn get_memory_provider_config(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<Value, DesktopFailure> {
    let path = format!(
        "{}?surface=declared",
        memory_provider_path(&provider, "/config")?
    );
    config_request_to_profile(&state, &profile, reqwest::Method::GET, &path, None).await
}

#[tauri::command]
pub async fn save_memory_provider_config(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
    values: Map<String, Value>,
) -> Result<Value, DesktopFailure> {
    let encoded = serde_json::to_vec(&values).map_err(|_| DesktopFailure::invalid_input())?;
    if values.len() > 128
        || encoded.len() > 256 * 1024
        || values
            .keys()
            .any(|key| key.is_empty() || key.len() > 128 || key.chars().any(char::is_control))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let path = format!(
        "{}?surface=declared",
        memory_provider_path(&provider, "/config")?
    );
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::PUT,
        &path,
        Some(json!({ "values": values })),
    )
    .await
}

#[tauri::command]
pub async fn start_memory_provider_oauth(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<Value, DesktopFailure> {
    let path = memory_provider_path(&provider, "/oauth/start")?;
    config_request_to_profile(&state, &profile, reqwest::Method::POST, &path, None).await
}

#[tauri::command]
pub async fn get_memory_provider_oauth_status(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<Value, DesktopFailure> {
    let path = memory_provider_path(&provider, "/oauth/status")?;
    config_request_to_profile(&state, &profile, reqwest::Method::GET, &path, None).await
}

#[tauri::command]
pub async fn get_shared_metrics_consent(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    state
        .resolve_chat_gateway(&profile)
        .await?
        .request("shared_metrics.status", json!({}))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_shared_metrics_consent(
    state: State<'_, BackendState>,
    profile: String,
    enabled: bool,
) -> Result<Value, DesktopFailure> {
    state
        .resolve_chat_gateway(&profile)
        .await?
        .request(
            "shared_metrics.set",
            json!({ "enabled": enabled, "send": enabled, "first_run": false }),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_delegation_routing(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/delegation/routing",
        None,
    )
    .await
}

#[tauri::command]
pub async fn select_delegation_backend(
    state: State<'_, BackendState>,
    profile: String,
    backend: String,
) -> Result<Value, DesktopFailure> {
    if backend.is_empty() || backend.len() > 128 || backend.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::PUT,
        "/api/delegation/backend",
        Some(json!({ "backend": backend })),
    )
    .await
}

#[tauri::command]
pub async fn save_delegation_model_map(
    state: State<'_, BackendState>,
    profile: String,
    value: Value,
) -> Result<Value, DesktopFailure> {
    if !value.is_object()
        || serde_json::to_vec(&value)
            .map_err(|_| DesktopFailure::invalid_input())?
            .len()
            > 128 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::PUT,
        "/api/delegation/backends/model_map",
        Some(value),
    )
    .await
}

#[tauri::command]
pub async fn save_delegation_profile_routes(
    state: State<'_, BackendState>,
    profile: String,
    value: Value,
) -> Result<Value, DesktopFailure> {
    if !value.is_object()
        || serde_json::to_vec(&value)
            .map_err(|_| DesktopFailure::invalid_input())?
            .len()
            > 128 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::PUT,
        "/api/delegation/backends/profile_routes",
        Some(value),
    )
    .await
}

#[tauri::command]
pub async fn transcribe_audio(
    state: State<'_, BackendState>,
    profile: String,
    data_url: String,
    mime_type: String,
) -> Result<Value, DesktopFailure> {
    if data_url.len() > 32 * 1024 * 1024
        || !data_url.starts_with("data:audio/")
        || mime_type.is_empty()
        || mime_type.len() > 128
        || !mime_type.starts_with("audio/")
    {
        return Err(DesktopFailure::invalid_input());
    }
    if let Some(result) = voice_direct::transcribe(&state, &profile, &data_url, &mime_type).await? {
        return Ok(result);
    }
    config_request_to_profile_with_limits(
        &state,
        &profile,
        reqwest::Method::POST,
        "/api/audio/transcribe",
        Some(json!({ "data_url": data_url, "mime_type": mime_type })),
        Duration::from_secs(600),
        2 * 1024 * 1024,
    )
    .await
}

#[tauri::command]
pub async fn speak_text(
    state: State<'_, BackendState>,
    profile: String,
    text: String,
) -> Result<Value, DesktopFailure> {
    let text = text.trim();
    if text.is_empty() || text.len() > 100_000 {
        return Err(DesktopFailure::invalid_input());
    }
    if let Some(result) = voice_direct::speak(&state, &profile, text).await? {
        return Ok(result);
    }
    config_request_to_profile_with_limits(
        &state,
        &profile,
        reqwest::Method::POST,
        "/api/audio/speak",
        Some(json!({ "text": text })),
        Duration::from_secs(600),
        32 * 1024 * 1024,
    )
    .await
}

#[cfg(test)]
#[path = "tests/settings_extras.rs"]
mod tests;
