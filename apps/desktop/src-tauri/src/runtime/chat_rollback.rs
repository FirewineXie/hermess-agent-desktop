use super::BackendState;
use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn session_params(session_id: &str) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 || session_id.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(json!({"session_id": session_id}))
}

fn checkpoint_params(session_id: &str, hash: &str) -> Result<Value, DesktopFailure> {
    if hash.is_empty()
        || hash.len() > 128
        || hash
            .chars()
            .any(|value| value.is_whitespace() || value.is_control())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut params = session_params(session_id)?;
    params["hash"] = json!(hash);
    Ok(params)
}

fn restore_params(
    session_id: &str,
    hash: &str,
    file_path: Option<String>,
    all: Option<bool>,
) -> Result<Value, DesktopFailure> {
    let mut params = checkpoint_params(session_id, hash)?;
    if let Some(path) = file_path {
        if path.is_empty() || path.len() > 32_768 || path.contains('\0') || all == Some(true) {
            return Err(DesktopFailure::invalid_input());
        }
        params["file_path"] = json!(path);
    } else if all == Some(true) {
        params["all"] = json!(true);
    }
    Ok(params)
}

fn write_log(storage: &std::path::Path, profile: &str, operation: &str, id: &str, phase: &str) {
    let _ = append_client_event(
        storage,
        &format!("chat_rollback action={operation} operation={id} profile={profile} {phase}"),
    );
}

#[tauri::command]
pub async fn list_chat_rollback_checkpoints(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
) -> Result<Value, DesktopFailure> {
    let params = session_params(&session_id)?;
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4().to_string();
    write_log(
        &scope.storage,
        &scope.profile,
        "list",
        &operation,
        "phase=start",
    );
    let result = scope.gateway.request("rollback.list", params).await;
    write_log(
        &scope.storage,
        &scope.profile,
        "list",
        &operation,
        if result.is_ok() {
            "status=ok"
        } else {
            "status=failed"
        },
    );
    result.map_err(Into::into)
}

#[tauri::command]
pub async fn diff_chat_rollback_checkpoint(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    hash: String,
) -> Result<Value, DesktopFailure> {
    let params = checkpoint_params(&session_id, &hash)?;
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4().to_string();
    write_log(
        &scope.storage,
        &scope.profile,
        "diff",
        &operation,
        "phase=start",
    );
    let result = scope.gateway.request("rollback.diff", params).await;
    write_log(
        &scope.storage,
        &scope.profile,
        "diff",
        &operation,
        if result.is_ok() {
            "status=ok"
        } else {
            "status=failed"
        },
    );
    result.map_err(Into::into)
}

#[tauri::command]
pub async fn restore_chat_rollback_checkpoint(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    hash: String,
    file_path: Option<String>,
    all: Option<bool>,
) -> Result<Value, DesktopFailure> {
    let mode = if file_path.is_some() {
        "file"
    } else if all == Some(true) {
        "all"
    } else {
        "safe"
    };
    let params = restore_params(&session_id, &hash, file_path, all)?;
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4().to_string();
    write_log(
        &scope.storage,
        &scope.profile,
        "restore",
        &operation,
        &format!("phase=start mode={mode}"),
    );
    let result = scope.gateway.request("rollback.restore", params).await;
    let outcome = match &result {
        Ok(value) if value.get("success").and_then(Value::as_bool) == Some(true) => "status=ok",
        Ok(_) => "status=rejected",
        Err(_) => "status=failed",
    };
    write_log(
        &scope.storage,
        &scope.profile,
        "restore",
        &operation,
        &format!("{outcome} mode={mode}"),
    );
    result.map_err(Into::into)
}

#[cfg(test)]
#[path = "tests/chat_rollback.rs"]
mod contract_tests;
