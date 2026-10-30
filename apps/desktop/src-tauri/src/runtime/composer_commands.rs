use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{chat::composer_catalog_params, BackendState};

pub(super) async fn execute(
    state: &BackendState,
    browser_bridge: &super::browser_bridge::BrowserBridgeState,
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
        } else if command_name == "/reload-mcp" {
            let response = scope.gateway.request(
                "reload.mcp",
                json!({"session_id": session_id, "confirm": true}),
            ).await?;
            scope.ensure_current(state).await?;
            if response.get("status").and_then(Value::as_str) != Some("reloaded") {
                return Err(DesktopFailure::operation_failed());
            }
            let message = response.get("message").and_then(Value::as_str).ok_or_else(DesktopFailure::operation_failed)?;
            Ok(json!({"type": "exec", "output": message}))
        } else if command_name == "/reload-skills" {
            let response = scope.gateway.request(
                "skills.reload",
                json!({"session_id": session_id}),
            ).await?;
            scope.ensure_current(state).await?;
            let output = response.get("output").and_then(Value::as_str).ok_or_else(DesktopFailure::operation_failed)?;
            Ok(json!({"type": "exec", "output": output}))
        } else if command_name == "/browser" {
            let arg = command.strip_prefix("/browser").unwrap_or("").trim();
            let action = if arg.is_empty() { "status".to_string() } else { arg.to_ascii_lowercase() };
            if action == "connect" {
                browser_bridge.ensure(state, &profile, &session_id).await?;
            } else if action == "disconnect" {
                browser_bridge.close(state, &profile, &session_id).await?;
            }
            scope.ensure_current(state).await?;
            let response = scope.gateway.request(
                "browser.manage",
                if action.starts_with("use") {
                    json!({"session_id": session_id, "action": "use", "enabled": action != "use off"})
                } else {
                    json!({"session_id": session_id, "action": "status"})
                },
            ).await?;
            scope.ensure_current(state).await?;
            let connected = response.get("connected").and_then(Value::as_bool).ok_or_else(DesktopFailure::operation_failed)?;
            let browser_use = response.get("browser_use").and_then(Value::as_bool).ok_or_else(DesktopFailure::operation_failed)?;
            let output = format!("Browser: {}; Browser Use: {}", if connected { "connected" } else { "disconnected" }, if browser_use { "on" } else { "off" });
            Ok(json!({"type": "exec", "output": output}))
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
