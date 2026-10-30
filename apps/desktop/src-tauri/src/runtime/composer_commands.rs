use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{chat::composer_catalog_params, BackendState};

pub(super) async fn execute(
    state: &BackendState,
    profile: String,
    session_id: String,
    command: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    if !command.starts_with('/') || command.len() > 64 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    let command_name = command.split_whitespace().next().unwrap_or("");
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("composer_start operation={operation} command={command_name} profile={profile} session={session_id}"),
    );
    let result = async {
        let catalog = scope
            .gateway
            .request("commands.catalog", composer_catalog_params(&session_id)?)
            .await?;
        if !super::composer_policy::allowed(&catalog, &command) {
            return Err(DesktopFailure::invalid_input());
        }
        if command.trim() == "/agents" {
            let roster = scope
                .gateway
                .request("subagent.list", json!({"session_id": session_id}))
                .await?;
            Ok(json!({"type": "exec", "output": super::composer_agents::format_roster(&roster)}))
        } else if command_name == "/branch" {
            super::composer_branch::execute(
                state,
                &scope,
                &session_id,
                command.strip_prefix("/branch").unwrap_or("").trim(),
            )
            .await
        } else if command_name == "/undo" {
            super::composer_undo::execute(
                state,
                &scope,
                &session_id,
                command.strip_prefix("/undo").unwrap_or("").trim(),
            )
            .await
        } else if command_name == "/queue" {
            super::composer_queue::execute(
                state,
                &scope,
                &session_id,
                command.strip_prefix("/queue").unwrap_or("").trim(),
            )
            .await
        } else {
            scope
                .gateway
                .request(
                    "slash.exec",
                    json!({"session_id": session_id, "command": command}),
                )
                .await
                .map_err(Into::into)
        }
    }
    .await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("composer_{outcome} operation={operation} command={command_name} profile={profile} session={session_id}"),
    );
    result
}
