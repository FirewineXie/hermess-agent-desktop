use super::{config::config_request_for_scope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn get_usage_statistics(
    state: State<'_, BackendState>,
    profile: String,
    days: u16,
) -> Result<Value, DesktopFailure> {
    if !matches!(days, 7 | 30 | 90) {
        return Err(DesktopFailure::invalid_input());
    }

    // Both endpoints read the current product-owned Hermes database. The token stays in Rust.
    let scope = state.resolve_profile(&profile).await?;
    let usage = config_request_for_scope(
        &state,
        &scope,
        Method::GET,
        &format!("/api/analytics/usage?days={days}&profile={profile}"),
        None,
    )
    .await?;
    let models = config_request_for_scope(
        &state,
        &scope,
        Method::GET,
        &format!("/api/analytics/models?days={days}&profile={profile}"),
        None,
    )
    .await?;
    let (Some(daily), Some(totals), Some(model_rows)) = (
        usage.get("daily").and_then(Value::as_array),
        usage.get("totals").and_then(Value::as_object),
        models.get("models").and_then(Value::as_array),
    ) else {
        return Err(DesktopFailure::operation_failed());
    };

    Ok(json!({
        "daily": daily,
        "totals": totals,
        "models": model_rows,
        "period_days": days,
    }))
}
