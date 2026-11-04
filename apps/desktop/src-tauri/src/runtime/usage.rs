use super::{config::config_request_for_scope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

fn usage_paths(profile: &str, days: u16) -> [String; 2] {
    [
        format!("/api/analytics/usage?days={days}&profile={profile}"),
        format!("/api/analytics/models?days={days}&profile={profile}"),
    ]
}

#[tauri::command]
pub async fn get_model_usage_statistics(
    state: State<'_, BackendState>,
    profile: String,
    days: u16,
) -> Result<Value, DesktopFailure> {
    if !matches!(days, 7 | 30 | 90) {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let operation = uuid::Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("model_usage_read_start operation={operation} profile={profile} days={days}"),
    );
    let result = async {
        let [_, path] = usage_paths(&profile, days);
        let response = config_request_for_scope(&state, &scope, Method::GET, &path, None).await?;
        if !response.get("models").is_some_and(Value::is_array)
            || !response.get("totals").is_some_and(Value::is_object)
            || !response["totals"]["distinct_models"].is_number()
            || !response["totals"]["total_sessions"].is_number()
        {
            return Err(DesktopFailure::operation_failed());
        }
        Ok(response)
    }
    .await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("model_usage_read_{outcome} operation={operation} profile={profile} days={days}"),
    );
    result
}

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
    let [usage_path, models_path] = usage_paths(&profile, days);
    let usage = config_request_for_scope(&state, &scope, Method::GET, &usage_path, None).await?;
    let models = config_request_for_scope(&state, &scope, Method::GET, &models_path, None).await?;
    let (Some(daily), Some(totals), Some(model_rows), Some(skills)) = (
        usage.get("daily").and_then(Value::as_array),
        usage.get("totals").and_then(Value::as_object),
        models.get("models").and_then(Value::as_array),
        usage
            .get("skills")
            .and_then(|value| value.get("top_skills"))
            .and_then(Value::as_array),
    ) else {
        return Err(DesktopFailure::operation_failed());
    };

    Ok(json!({
        "daily": daily,
        "totals": totals,
        "models": model_rows,
        "skills": skills,
        "period_days": days,
    }))
}

#[cfg(test)]
#[path = "tests/usage.rs"]
mod tests;
