use super::BackendState;
use crate::errors::DesktopFailure;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::State;
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
pub struct ReplayResult {
    events: Vec<ReplayEvent>,
    latest_seq: u64,
    count: u64,
    epoch: String,
    truncated: bool,
    open_requests: Vec<Value>,
}

#[derive(Deserialize, Serialize)]
struct ReplayEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Map<String, Value>>,
}

#[tauri::command]
pub async fn create_chat_session(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    let gateway = state.gateway().await?;
    let result = gateway
        .request(
            "session.create",
            json!({
                "source": "gui", "request_id": Uuid::new_v4().to_string()
            }),
        )
        .await?;
    if result.get("session_id").and_then(Value::as_str).is_none()
        || result
            .get("stored_session_id")
            .and_then(Value::as_str)
            .is_none()
    {
        return Err("网关未返回完整会话标识".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn submit_chat_prompt(
    state: State<'_, BackendState>,
    session_id: String,
    text: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    if text.trim().is_empty() || text.len() > 64 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request(
            "prompt.submit",
            json!({"session_id":session_id,"text":text,"submission_id":Uuid::new_v4().to_string()}),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_composer_commands(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request("commands.catalog", json!({"session_id": session_id}))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn execute_composer_command(
    state: State<'_, BackendState>,
    session_id: String,
    command: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    if !command.starts_with('/') || command.len() > 64 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request(
            "slash.exec",
            json!({"session_id": session_id, "command": command}),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn dispatch_composer_skill(
    state: State<'_, BackendState>,
    session_id: String,
    name: String,
    arg: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    if name.is_empty()
        || name.len() > 256
        || name.contains(char::is_whitespace)
        || arg.len() > 64 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request(
            "command.dispatch",
            json!({
                "session_id": session_id, "name": name, "arg": arg
            }),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn attach_chat_file(
    state: State<'_, BackendState>,
    session_id: String,
    path: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    if path.len() > 4096 {
        return Err(DesktopFailure::invalid_input());
    }
    let source = PathBuf::from(path);
    if !source.is_absolute() {
        return Err(DesktopFailure::invalid_input());
    }
    let source = source
        .canonicalize()
        .map_err(|_| "无法读取附件路径".to_string())?;
    let metadata = fs::metadata(&source).map_err(|_| "无法读取附件信息".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 20 * 1024 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("附件");
    let is_image = matches!(
        source
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "svg" | "ico")
    );
    let is_text = matches!(
        source
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("txt" | "md" | "json" | "yaml" | "yml" | "csv" | "tsv" | "py" | "js" | "ts" | "rs")
    );
    let preview = if is_text && metadata.len() <= 128 * 1024 {
        fs::read_to_string(&source)
            .ok()
            .map(|content| content.chars().take(1000).collect::<String>())
    } else {
        None
    };
    let method = if is_image {
        "image.attach"
    } else {
        "file.attach"
    };
    let gateway = state.gateway().await?;
    let result = gateway
        .request(
            method,
            json!({
                "session_id": session_id, "path": source.to_string_lossy(), "name": name
            }),
        )
        .await?;
    if result.get("attached").and_then(Value::as_bool) != Some(true) {
        return Err("后端未接受附件".into());
    }
    if is_image && result.get("path").and_then(Value::as_str).is_none()
        || !is_image && result.get("ref_text").and_then(Value::as_str).is_none()
    {
        return Err("后端附件响应缺少必要标识".into());
    }
    Ok(
        json!({"kind": if is_image { "image" } else { "file" }, "name": name,
        "source_path": source.to_string_lossy(), "bytes": metadata.len(), "preview": preview,
        "ref_text": result.get("ref_text"),
        "path": result.get("path")}),
    )
}

#[tauri::command]
pub async fn detach_chat_image(
    state: State<'_, BackendState>,
    session_id: String,
    path: String,
) -> Result<(), DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 || path.len() > 4096 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    let result = gateway
        .request(
            "image.detach",
            json!({
                "session_id": session_id, "path": path
            }),
        )
        .await?;
    if result.get("detached").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::conflict());
    }
    Ok(())
}

#[tauri::command]
pub async fn answer_gateway_request(
    state: State<'_, BackendState>,
    request_id: String,
    method: String,
    choice: Option<String>,
    answers: Option<serde_json::Map<String, Value>>,
) -> Result<(), DesktopFailure> {
    if !request_id.starts_with("srq-") || request_id.len() > 128 {
        return Err(DesktopFailure::invalid_input());
    }
    let result = match method.as_str() {
        "approval" => {
            let selected = choice.ok_or_else(DesktopFailure::invalid_input)?;
            if !matches!(selected.as_str(), "once" | "session" | "always" | "deny") {
                return Err(DesktopFailure::invalid_input());
            }
            json!({"choice":selected})
        }
        "clarify" => {
            let answers = answers.ok_or_else(DesktopFailure::invalid_input)?;
            if answers.len() > 5
                || answers.iter().any(|(key, value)| {
                    key.len() > 128
                        || !value.is_null() && value.as_str().is_none_or(|text| text.len() > 4096)
                })
            {
                return Err(DesktopFailure::invalid_input());
            }
            json!({"answers":answers,"outcome":"submitted"})
        }
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let gateway = state.gateway().await?;
    gateway
        .answer(request_id, method, result)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_chat_sessions(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    let gateway = state.gateway().await?;
    let live = gateway.request("session.list", json!({"limit":50})).await?;
    let stored = gateway
        .request("session.list", json!({"limit":50,"scope":"stored"}))
        .await?;
    Ok(merge_session_lists(&live, &stored))
}

fn merge_session_lists(live: &Value, stored: &Value) -> Value {
    let mut sessions = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in live
        .get("sessions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .chain(
            stored
                .get("sessions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        )
    {
        if let Some(id) = row.get("id").and_then(Value::as_str) {
            if seen.insert(id.to_owned()) {
                sessions.push(row.clone());
            }
        }
    }
    sessions.sort_by(|a, b| {
        let left = a.get("started_at").and_then(Value::as_f64).unwrap_or(0.0);
        let right = b.get("started_at").and_then(Value::as_f64).unwrap_or(0.0);
        right.total_cmp(&left)
    });
    sessions.truncate(50);
    json!({"sessions": sessions})
}

#[tauri::command]
pub async fn get_chat_reasoning(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, DesktopFailure> {
    if session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    let params = if session_id.is_empty() {
        json!({"key": "reasoning"})
    } else {
        json!({"session_id": session_id, "key": "reasoning"})
    };
    gateway
        .request("config.get", params)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn set_chat_reasoning(
    state: State<'_, BackendState>,
    session_id: String,
    value: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    if !matches!(
        value.as_str(),
        "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
    ) {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request(
            "config.set",
            json!({"session_id": session_id, "key": "reasoning", "value": value}),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_chat_usage(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request("session.stats", json!({"session_id": session_id}))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn resume_chat_session(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request(
            "session.resume",
            json!({"session_id":session_id,"source":"desktop"}),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn interrupt_chat_session(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    gateway
        .request("session.interrupt", json!({"session_id":session_id}))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn replay_chat_events(
    state: State<'_, BackendState>,
    session_id: String,
    last_seen: u64,
    replay_epoch: String,
) -> Result<ReplayResult, DesktopFailure> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.gateway().await?;
    let result = gateway
        .request(
            "session.events.since",
            json!({"session_id":session_id,"last_seen":last_seen,"replay_epoch":replay_epoch}),
        )
        .await?;
    serde_json::from_value(result).map_err(|_| DesktopFailure::operation_failed())
}

#[cfg(test)]
#[path = "tests/chat.rs"]
mod contract_tests;
