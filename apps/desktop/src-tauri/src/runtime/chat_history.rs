use super::BackendState;
use crate::{
    diagnostics::append_client_event, errors::DesktopFailure, gateway::GatewayRequestError,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum HistoryOperation {
    Rewind,
    Branch,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryChange {
    operation: HistoryOperation,
    row_id: u64,
    request_id: String,
    revision: u64,
    generation: u64,
}

fn history_params(session: &str, change: &HistoryChange) -> Result<Value, DesktopFailure> {
    if session.is_empty()
        || session.len() > 256
        || change.row_id == 0
        || Uuid::parse_str(&change.request_id).is_err()
    {
        return Err(DesktopFailure::invalid_input());
    }
    let (operation, payload) = match change.operation {
        HistoryOperation::Rewind => ("rewind", json!({"target_message_id": change.row_id})),
        HistoryOperation::Branch => ("branch", json!({"through_message_id": change.row_id})),
    };
    Ok(
        json!({"session_id": session, "request_id": change.request_id, "operation": operation,
        "expected_revision": change.revision, "expected_generation": change.generation, "payload": payload}),
    )
}

#[tauri::command]
pub async fn mutate_chat_history(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    change: HistoryChange,
) -> Result<Value, DesktopFailure> {
    let params = history_params(&session_id, &change)?;
    let scope = state.resolve_chat_profile(&profile).await?;
    let log = |phase| {
        let _ = append_client_event(
            &scope.storage,
            &format!(
                "chat_history request={} profile={profile} phase={phase}",
                change.request_id
            ),
        );
    };
    log("start");
    let result = async {
        scope.ensure_current(&state).await?;
        let receipt = scope
            .gateway
            .request_detailed("session.mutate", params)
            .await
            .map_err(|error| match error {
                GatewayRequestError::Transport(_) => DesktopFailure::timeout(),
                GatewayRequestError::Rpc { message, code } => format!("{message} ({code})").into(),
            })?;
        scope.ensure_current(&state).await?;
        match change.operation {
            HistoryOperation::Rewind => receipt["rewound_count"]
                .as_u64()
                .filter(|count| *count > 0)
                .map(|count| json!({"rewound_count": count})),
            HistoryOperation::Branch => receipt["branched_session_id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .map(|id| json!({"branched_session_id": id})),
        }
        .ok_or_else(DesktopFailure::operation_failed)
    }
    .await;
    log(if result.is_ok() {
        "completed"
    } else {
        "failed"
    });
    result
}

#[cfg(test)]
#[path = "tests/chat_history.rs"]
mod tests;
