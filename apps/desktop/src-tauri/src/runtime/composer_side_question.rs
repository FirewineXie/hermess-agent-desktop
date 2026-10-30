use crate::errors::{DesktopFailure, SESSION_OWNER_UNKNOWN, SESSION_PROFILE_MISMATCH};
use crate::gateway::GatewayRequestError;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use super::BackendState;

#[tauri::command]
pub async fn ask_side_question(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    question: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty()
        || session_id.len() > 256
        || question.trim().is_empty()
        || question.len() > 64 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    let log = |stage: &str| {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("side_question_{stage} operation={operation} profile={profile} session={session_id}"),
        );
    };
    log("start");
    let result = async {
        scope.gateway.request(
            "session.resume",
            json!({"session_id": session_id, "source": "desktop", "defer_history": true, "omit_messages": true}),
        ).await?;
        match scope.gateway.request_detailed(
            "prompt.btw",
            json!({"session_id": session_id, "text": question.trim()}),
        ).await {
            Ok(receipt) => match receipt["task_id"].as_str() {
                Some(task_id) if task_id.starts_with("btw_") => Ok(json!({"task_id": task_id})),
                _ => Err(DesktopFailure::operation_failed()),
            },
            Err(GatewayRequestError::Transport(message)) if matches!(message.as_str(), SESSION_OWNER_UNKNOWN | SESSION_PROFILE_MISMATCH) => Err(message.into()),
            Err(GatewayRequestError::Transport(_)) => Ok(json!({"status": "unknown"})),
            Err(_) => Err(DesktopFailure::operation_failed()),
        }
    }.await;
    log(match &result {
        Ok(value) if value["task_id"].as_str().is_some() => "admitted",
        Ok(value) if value["status"] == "unknown" => "result_unknown",
        _ => "failed",
    });
    result
}
