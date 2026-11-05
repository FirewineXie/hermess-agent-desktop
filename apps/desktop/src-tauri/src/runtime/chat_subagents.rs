use super::BackendState;
use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn identifier(value: &str) -> Result<(), DesktopFailure> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}

fn params(session_id: &str, subagent_id: Option<&str>) -> Result<Value, DesktopFailure> {
    identifier(session_id)?;
    let mut value = json!({ "session_id": session_id });
    if let Some(id) = subagent_id {
        identifier(id)?;
        value["subagent_id"] = json!(id);
    }
    Ok(value)
}

fn log(storage: &std::path::Path, profile: &str, action: &str, operation: Uuid, result: &str) {
    let _ = append_client_event(
        storage,
        &format!(
            "chat_subagent action={action} operation={operation} profile={profile} result={result}"
        ),
    );
}

#[tauri::command]
pub async fn list_chat_subagents(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
) -> Result<Value, DesktopFailure> {
    let request = params(&session_id, None)?;
    let scope = state.resolve_profile(&profile).await?;
    let result = scope.gateway.request("subagent.list", request).await?;
    scope.ensure_current(&state).await?;
    if !result["subagents"].is_array() || !result["delegations"].is_array() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(result)
}

#[tauri::command]
pub async fn read_chat_subagent_tail(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    subagent_id: String,
) -> Result<Value, DesktopFailure> {
    let request = params(&session_id, Some(&subagent_id))?;
    let scope = state.resolve_profile(&profile).await?;
    let result = scope.gateway.request("subagent.tail", request).await?;
    scope.ensure_current(&state).await?;
    if result["subagent_id"].as_str() != Some(subagent_id.as_str())
        || !result["available"].is_boolean()
        || !result["text"].is_string()
        || !result["truncated"].is_boolean()
    {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(result)
}

async fn control(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    subagent_id: String,
    text: Option<String>,
) -> Result<Value, DesktopFailure> {
    let mut request = params(&session_id, Some(&subagent_id))?;
    let (action, method) = if let Some(text) = text {
        if text.trim().is_empty() || text.len() > 4096 || text.contains('\0') {
            return Err(DesktopFailure::invalid_input());
        }
        request["text"] = json!(text);
        ("steer", "subagent.steer")
    } else {
        ("stop", "subagent.interrupt")
    };
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    log(&scope.storage, &profile, action, operation, "started");
    let result = scope.gateway.request(method, request).await;
    let result = match result {
        Ok(value) => {
            if let Err(error) = scope.ensure_current(&state).await {
                Err(error)
            } else {
                let accepted = if action == "steer" {
                    matches!(value["status"].as_str(), Some("queued" | "rejected"))
                } else {
                    value["found"].is_boolean()
                };
                if value["subagent_id"].as_str() != Some(subagent_id.as_str()) || !accepted {
                    Err(DesktopFailure::operation_failed())
                } else {
                    Ok(value)
                }
            }
        }
        Err(error) => Err(error.into()),
    };
    let outcome = match &result {
        Ok(value) if action == "steer" && value["status"] == "queued" => "queued",
        Ok(value) if action == "stop" && value["found"] == true => "found",
        Ok(_) => "rejected",
        Err(_) => "failed",
    };
    log(&scope.storage, &profile, action, operation, outcome);
    result
}

#[tauri::command]
pub async fn steer_chat_subagent(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    subagent_id: String,
    text: String,
) -> Result<Value, DesktopFailure> {
    control(state, profile, session_id, subagent_id, Some(text)).await
}

#[tauri::command]
pub async fn stop_chat_subagent(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    subagent_id: String,
) -> Result<Value, DesktopFailure> {
    control(state, profile, session_id, subagent_id, None).await
}
