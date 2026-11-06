use super::{config::config_request_for_scope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

fn system_stats_path() -> &'static str {
    "/api/system/stats"
}

#[tauri::command]
pub async fn get_system_stats(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile("default").await?;
    let operation = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("system_stats_read_start operation={operation}"),
    );
    let result = async {
        let stats =
            config_request_for_scope(&state, &scope, Method::GET, system_stats_path(), None)
                .await?;
        if !stats.get("os").is_some_and(Value::is_string)
            || !stats.get("arch").is_some_and(Value::is_string)
            || !stats.get("python_version").is_some_and(Value::is_string)
            || !stats.get("hermes_version").is_some_and(Value::is_string)
            || !stats.get("psutil").is_some_and(Value::is_boolean)
        {
            return Err(DesktopFailure::operation_failed());
        }
        Ok(stats)
    }
    .await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("system_stats_read_{outcome} operation={operation}"),
    );
    result
}

#[cfg(test)]
#[path = "tests/system_stats.rs"]
mod tests;
