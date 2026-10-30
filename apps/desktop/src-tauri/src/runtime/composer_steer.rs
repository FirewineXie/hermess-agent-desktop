use crate::errors::{DesktopFailure, SESSION_OWNER_UNKNOWN, SESSION_PROFILE_MISMATCH};
use crate::gateway::GatewayRequestError;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use super::BackendState;

#[tauri::command]
pub async fn steer_chat_session(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    text: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty()
        || session_id.len() > 256
        || text.trim().is_empty()
        || text.len() > 64 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    let log = |stage: &str| {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("session_steer_{stage} operation={operation} profile={profile} session={session_id}"),
        );
    };
    log("start");
    let result = async {
        let snapshot = scope.gateway.request(
            "session.resume",
            json!({"session_id": session_id, "source": "desktop", "defer_history": true, "omit_messages": true}),
        ).await?;
        if snapshot["running"] != true {
            return Err(DesktopFailure::conflict());
        }
        let generation = snapshot["execution_generation"].as_u64()
            .ok_or_else(DesktopFailure::operation_failed)?;
        let receipt = match scope.gateway.request_detailed(
            "session.steer",
            json!({"session_id": session_id, "execution_generation": generation, "text": text}),
        ).await {
            Ok(value) => value,
            Err(GatewayRequestError::Transport(message)) if matches!(message.as_str(), SESSION_OWNER_UNKNOWN | SESSION_PROFILE_MISMATCH) => return Err(message.into()),
            Err(GatewayRequestError::Transport(_)) => return Ok(json!({"status": "unknown"})),
            Err(GatewayRequestError::Rpc { message, .. }) if matches!(message.as_str(), "stale_generation" | "session_not_running" | "not_running") => return Err(DesktopFailure::conflict()),
            Err(_) => return Err(DesktopFailure::operation_failed()),
        };
        match receipt["status"].as_str() {
            Some("queued") => Ok(json!({"status": "queued"})),
            Some("rejected") => Ok(json!({"status": "rejected", "delivered": receipt["delivered"]})),
            _ => Err(DesktopFailure::operation_failed()),
        }
    }.await;
    log(match &result {
        Ok(value) if value["status"] == "queued" => "queued",
        Ok(value) if value["status"] == "unknown" => "result_unknown",
        Ok(_) => "rejected",
        Err(_) => "failed",
    });
    result
}
