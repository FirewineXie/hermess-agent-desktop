use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::State;
use tauri::Url;

use super::{profiles::ProfiledGateway, BackendState};
use crate::{diagnostics::log_client_event, errors::DesktopFailure};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ConnectionCommand {
    Respond { op_id: String, answer: Answer },
    Status { op_id: String },
    Wake { op_id: String },
    Open { op_id: String, name: String },
    Retry { op_id: String, name: String },
}

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Answer {
    #[serde(skip_serializing_if = "Option::is_none")]
    targets: Option<Vec<AnswerTarget>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    settled_by: Option<ContinueReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    said: Option<String>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct AnswerTarget {
    name: String,
    status: AnswerStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<BTreeMap<String, String>>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum AnswerStatus {
    Approved,
    Skipped,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum ContinueReason {
    Continue,
}

fn operation_params(session_id: &str, op_id: &str) -> Value {
    json!({"owner": {"type": "session", "session_id": session_id}, "op_id": op_id})
}

fn response_params(
    session_id: &str,
    op_id: &str,
    answer: &Answer,
) -> Result<Value, DesktopFailure> {
    // The Gateway shares this map with advanced catalog options. The product card
    // submits credentials only, so a field must never override the selected Profile or pin.
    if answer.targets.iter().flatten().any(|target| {
        target.env.iter().flat_map(|env| env.keys()).any(|key| {
            matches!(
                key.as_str(),
                "target_profile" | "agent_half" | "desktop_half" | "enable" | "force" | "ref"
            )
        })
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut params = operation_params(session_id, op_id);
    params["result"] = json!(answer);
    if params.to_string().len() > 32 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(params)
}

fn retry_params(session_id: &str, name: &str) -> Value {
    json!({"owner": {"type": "session", "session_id": session_id}, "connectors": [name], "reconnect": true})
}

fn authorization_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let loopback = matches!(url.host_str()?, "localhost" | "127.0.0.1" | "[::1]");
    (url.scheme() == "https" || (url.scheme() == "http" && loopback)).then_some(url)
}

async fn execute(
    gateway: &ProfiledGateway,
    session_id: &str,
    request: ConnectionCommand,
) -> Result<Value, DesktopFailure> {
    match request {
        ConnectionCommand::Respond { op_id, answer } => {
            let params = response_params(session_id, &op_id, &answer)?;
            Ok(gateway.request("connection.respond", params).await?)
        }
        ConnectionCommand::Status { op_id } => Ok(gateway
            .request(
                "connectors.operation.status",
                operation_params(session_id, &op_id),
            )
            .await?),
        ConnectionCommand::Wake { op_id } => Ok(gateway
            .request(
                "connectors.operation.wake",
                operation_params(session_id, &op_id),
            )
            .await?),
        ConnectionCommand::Retry { op_id, name } => {
            // The retry RPC acts on the session's current operation. Verify the selected
            // operation and row before calling it, and reject a card that has already settled.
            let snapshot = gateway
                .request(
                    "connectors.operation.status",
                    operation_params(session_id, &op_id),
                )
                .await?;
            let target = active_target(&snapshot, &name)?;
            if target["kind"] != "connector"
                || !matches!(target["state"].as_str(), Some("failed" | "expired"))
            {
                return Err(DesktopFailure::invalid_input());
            }
            Ok(gateway
                .request("connectors.connect", retry_params(session_id, &name))
                .await?)
        }
        ConnectionCommand::Open { op_id, name } => {
            let snapshot = gateway
                .request(
                    "connectors.operation.status",
                    operation_params(session_id, &op_id),
                )
                .await?;
            let target = active_target(&snapshot, &name)?;
            if target["state"] != "initiated" {
                return Err(DesktopFailure::invalid_input());
            }
            let url = target["connect_url"]
                .as_str()
                .and_then(authorization_url)
                .ok_or_else(DesktopFailure::invalid_input)?;
            tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
                .map_err(|_| DesktopFailure::operation_failed())?;
            Ok(json!({"status": "ok"}))
        }
    }
}

fn active_target<'a>(snapshot: &'a Value, name: &str) -> Result<&'a Value, DesktopFailure> {
    if snapshot["settled"] != false {
        return Err(DesktopFailure::invalid_input());
    }
    snapshot["targets"]
        .as_array()
        .and_then(|targets| targets.iter().find(|target| target["name"] == name))
        .ok_or_else(DesktopFailure::invalid_input)
}

#[tauri::command]
pub async fn chat_connection(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    gateway_epoch: String,
    request: ConnectionCommand,
) -> Result<Value, DesktopFailure> {
    let (action, op_id) = match &request {
        ConnectionCommand::Respond { op_id, .. } => ("respond", op_id),
        ConnectionCommand::Status { op_id } => ("status", op_id),
        ConnectionCommand::Wake { op_id } => ("wake", op_id),
        ConnectionCommand::Open { op_id, .. } => ("open", op_id),
        ConnectionCommand::Retry { op_id, .. } => ("retry", op_id),
    };
    if session_id.is_empty()
        || session_id.len() > 256
        || op_id.is_empty()
        || op_id.len() > 128
        || !op_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let op_id = op_id.clone();
    log_client_event(&format!("chat_connection start op={op_id} action={action}"));
    let result = match state.resolve_chat_profile(&profile).await {
        Ok(scope) if !gateway_epoch.is_empty() && scope.gateway.replay_epoch() == gateway_epoch => {
            execute(&scope.gateway, &session_id, request).await
        }
        Ok(_) => Err(DesktopFailure::invalid_input()),
        Err(error) => Err(error),
    };
    let outcome = if result.is_ok() { "ok" } else { "error" };
    log_client_event(&format!(
        "chat_connection end op={op_id} action={action} outcome={outcome}"
    ));
    result
}

#[cfg(test)]
#[path = "tests/chat_connections.rs"]
mod tests;
