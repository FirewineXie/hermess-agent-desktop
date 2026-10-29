use super::{
    config::{config_request_for_scope, CONFIG_WRITE_LOCK},
    BackendState,
};
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn get_shared_metrics_consent(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::GET,
        "/api/shared-metrics/consent",
        None,
    )
    .await
}

#[tauri::command]
pub async fn save_shared_metrics_consent(
    state: State<'_, BackendState>,
    profile: String,
    enabled: bool,
    send: bool,
) -> Result<Value, DesktopFailure> {
    let _guard = CONFIG_WRITE_LOCK.lock().await;
    let scope = state.resolve_profile(&profile).await?;
    config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::PUT,
        "/api/shared-metrics/consent",
        Some(json!({"enabled":enabled,"send":enabled && send})),
    )
    .await?;
    let result = config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::GET,
        "/api/shared-metrics/consent",
        None,
    )
    .await?;
    if result["enabled"] != enabled
        || result["send"] != (enabled && send)
        || result["decided"] != true
    {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_checkpoint_inventory(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::GET,
        "/api/ops/checkpoints",
        None,
    )
    .await
}
