use super::BackendState;
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
pub async fn create_chat_session(state: State<'_, BackendState>) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let result = backend
        .gateway
        .request(
            "session.create",
            json!({
                "source": "desktop", "idempotency_key": Uuid::new_v4().to_string()
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
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    if text.trim().is_empty() || text.len() > 64 * 1024 {
        return Err("消息为空或过长".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request(
            "prompt.submit",
            json!({"session_id":session_id,"text":text}),
        )
        .await
}

#[tauri::command]
pub async fn list_composer_commands(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("commands.catalog", json!({"session_id": session_id}))
        .await
}

#[tauri::command]
pub async fn execute_composer_command(
    state: State<'_, BackendState>,
    session_id: String,
    command: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    if !command.starts_with('/') || command.len() > 64 * 1024 {
        return Err("命令无效或过长".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request(
            "slash.exec",
            json!({"session_id": session_id, "command": command}),
        )
        .await
}

#[tauri::command]
pub async fn dispatch_composer_skill(
    state: State<'_, BackendState>,
    session_id: String,
    name: String,
    arg: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    if name.is_empty()
        || name.len() > 256
        || name.contains(char::is_whitespace)
        || arg.len() > 64 * 1024
    {
        return Err("Skill 命令无效或过长".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request(
            "command.dispatch",
            json!({
                "session_id": session_id, "name": name, "arg": arg
            }),
        )
        .await
}

#[tauri::command]
pub async fn attach_chat_file(
    state: State<'_, BackendState>,
    session_id: String,
    path: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    if path.len() > 4096 {
        return Err("附件路径过长".into());
    }
    let source = PathBuf::from(path);
    if !source.is_absolute() {
        return Err("附件必须使用绝对路径".into());
    }
    let source = source
        .canonicalize()
        .map_err(|_| "无法读取附件路径".to_string())?;
    let metadata = fs::metadata(&source).map_err(|_| "无法读取附件信息".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 20 * 1024 * 1024 {
        return Err("附件必须是非空文件且不超过 20 MiB".into());
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
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let result = backend
        .gateway
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
) -> Result<(), String> {
    if session_id.is_empty() || session_id.len() > 256 || path.len() > 4096 {
        return Err("附件标识无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let result = backend
        .gateway
        .request(
            "image.detach",
            json!({
                "session_id": session_id, "path": path
            }),
        )
        .await?;
    if result.get("detached").and_then(Value::as_bool) != Some(true) {
        return Err("未找到待移除的图片".into());
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
) -> Result<(), String> {
    if !request_id.starts_with("srq-") || request_id.len() > 128 {
        return Err("请求 ID 无效".into());
    }
    let result = match method.as_str() {
        "approval" => {
            let selected = choice.ok_or("缺少审批选择")?;
            if !matches!(selected.as_str(), "once" | "session" | "always" | "deny") {
                return Err("审批选择无效".into());
            }
            json!({"choice":selected})
        }
        "clarify" => {
            let answers = answers.ok_or("缺少澄清回答")?;
            if answers.len() > 5
                || answers.iter().any(|(key, value)| {
                    key.len() > 128
                        || !value.is_null() && value.as_str().is_none_or(|text| text.len() > 4096)
                })
            {
                return Err("澄清回答无效".into());
            }
            json!({"answers":answers,"outcome":"submitted"})
        }
        _ => return Err("不支持的请求类型".into()),
    };
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend.gateway.answer(request_id, result).await
}

#[tauri::command]
pub async fn list_chat_sessions(state: State<'_, BackendState>) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("session.list", json!({"limit":50}))
        .await
}

#[tauri::command]
pub async fn get_chat_reasoning(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request(
            "config.get",
            json!({"session_id": session_id, "key": "reasoning"}),
        )
        .await
}

#[tauri::command]
pub async fn get_chat_usage(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("session.stats", json!({"session_id": session_id}))
        .await
}

#[tauri::command]
pub async fn resume_chat_session(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request(
            "session.resume",
            json!({"session_id":session_id,"source":"desktop"}),
        )
        .await
}

#[tauri::command]
pub async fn interrupt_chat_session(
    state: State<'_, BackendState>,
    session_id: String,
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("session.interrupt", json!({"session_id":session_id}))
        .await
}

#[tauri::command]
pub async fn replay_chat_events(
    state: State<'_, BackendState>,
    session_id: String,
    last_seen: u64,
    replay_epoch: String,
) -> Result<ReplayResult, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let result = backend
        .gateway
        .request(
            "session.events.since",
            json!({"session_id":session_id,"last_seen":last_seen,"replay_epoch":replay_epoch}),
        )
        .await?;
    serde_json::from_value(result).map_err(|_| "网关补发结果格式无效".to_string())
}

#[cfg(test)]
mod contract_tests {
    use super::ReplayResult;

    #[test]
    fn replay_result_matches_shared_fixture_and_rejects_missing_watermark() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../packages/contracts/fixtures/replay-result.json"
        ))
        .unwrap();
        let result: ReplayResult = serde_json::from_value(fixture.clone()).unwrap();
        assert_eq!(serde_json::to_value(result).unwrap(), fixture);
        let mut missing_watermark = fixture;
        missing_watermark
            .as_object_mut()
            .unwrap()
            .remove("latest_seq");
        assert!(serde_json::from_value::<ReplayResult>(missing_watermark).is_err());
    }
}
