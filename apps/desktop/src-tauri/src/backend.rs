use crate::gateway::GatewayClient;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Stdio, time::Duration};
use tauri::{AppHandle, State};
use tokio::{
    process::Child,
    sync::Mutex,
    time::{sleep, timeout, Instant},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

#[derive(Default)]
pub struct BackendState(Mutex<Option<OwnedBackend>>);

struct OwnedBackend {
    _storage_lock: fs::File,
    child: Child,
    port: u16,
    token: String,
    gateway: GatewayClient,
}

#[derive(Serialize)]
pub struct BackendInfo {
    port: u16,
    pid: u32,
    replay_epoch: String,
}

#[derive(Serialize)]
pub struct DevDefaults {
    python_path: String,
    storage_path: String,
}

fn acquire_storage_lock(storage: &std::path::Path) -> Result<fs::File, String> {
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(storage.join("control").join("owner.lock"))
        .map_err(|_| "无法打开产品存储锁".to_string())?;
    lock.try_lock()
        .map_err(|_| "同一存储位置已有本产品实例，不能同时写入".to_string())?;
    Ok(lock)
}

#[tauri::command]
pub fn dev_backend_defaults() -> Result<DevDefaults, String> {
    if !cfg!(debug_assertions) {
        return Err("仅调试构建可用".into());
    }
    let product = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|_| "无法定位产品目录".to_string())?;
    let build = product.join(".build");
    let python = build.join("hermes-venv-i0").join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    Ok(DevDefaults {
        python_path: python.to_string_lossy().into_owned(),
        storage_path: build
            .join("desktop-dev-data")
            .to_string_lossy()
            .into_owned(),
    })
}

async fn ping(port: u16, token: &str) -> Result<(), String> {
    let url = format!("ws://127.0.0.1:{port}/api/ws?token={token}");
    let (mut socket, _) = timeout(Duration::from_secs(5), connect_async(url))
        .await
        .map_err(|_| "WebSocket 连接超时".to_string())?
        .map_err(|_| "WebSocket 鉴权或连接失败".to_string())?;
    socket
        .send(Message::Text(
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}"#.into(),
        ))
        .await
        .map_err(|_| "ping 请求发送失败".to_string())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while let Ok(Some(frame)) = timeout(
        deadline.saturating_duration_since(Instant::now()),
        socket.next(),
    )
    .await
    {
        let frame = frame.map_err(|_| "WebSocket 响应失败".to_string())?;
        if let Message::Text(text) = frame {
            let value: serde_json::Value =
                serde_json::from_str(&text).map_err(|_| "网关返回无效 JSON".to_string())?;
            if value.get("id").and_then(|id| id.as_i64()) == Some(1) {
                return if value
                    .pointer("/result/pong")
                    .and_then(|pong| pong.as_bool())
                    == Some(true)
                {
                    Ok(())
                } else {
                    Err("网关 ping 未返回 pong".to_string())
                };
            }
        }
    }
    Err("等待网关 ping 响应超时".to_string())
}

#[tauri::command]
pub async fn start_dev_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
    python_path: String,
    storage_path: String,
) -> Result<BackendInfo, String> {
    let mut owned = state.0.lock().await;
    if let Some(existing) = owned.as_mut() {
        if existing
            .child
            .try_wait()
            .map_err(|_| "进程状态读取失败".to_string())?
            .is_none()
        {
            if existing.gateway.is_closed() {
                existing.gateway =
                    GatewayClient::connect(existing.port, &existing.token, app).await?;
            }
            return Ok(BackendInfo {
                port: existing.port,
                pid: existing.child.id().unwrap_or(0),
                replay_epoch: existing.gateway.replay_epoch.clone(),
            });
        }
        *owned = None;
    }
    if !cfg!(debug_assertions) {
        return Err("开发态后端启动仅在调试构建可用".into());
    }
    let python = PathBuf::from(python_path)
        .canonicalize()
        .map_err(|_| "找不到已准备的 Python 环境".to_string())?;
    let product = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|_| "无法定位产品目录".to_string())?;
    if !python.starts_with(product.join(".build")) {
        return Err("I0 仅接受产品 .build 下的隔离 Python 环境".into());
    }
    let hermes = python.with_file_name(if cfg!(windows) {
        "hermes.exe"
    } else {
        "hermes"
    });
    if !hermes.is_file() {
        return Err("隔离环境缺少 Hermes 启动器".into());
    }
    let selected = PathBuf::from(storage_path);
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    fs::create_dir_all(&selected).map_err(|_| "无法创建存储位置".to_string())?;
    let storage = selected
        .canonicalize()
        .map_err(|_| "无法解析存储位置".to_string())?
        .join("HermessAgentDesktop");
    fs::create_dir_all(storage.join("control")).map_err(|_| "无法创建产品控制目录".to_string())?;
    let storage = storage
        .canonicalize()
        .map_err(|_| "无法解析产品存储目录".to_string())?;
    let storage_lock = acquire_storage_lock(&storage)?;
    let run = storage.join("control").join(Uuid::new_v4().to_string());
    fs::create_dir_all(&run).map_err(|_| "无法创建私有控制目录".to_string())?;
    let ready = run.join("ready.json");
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let output =
        fs::File::create(run.join("backend.log")).map_err(|_| "无法创建后端日志".to_string())?;
    let error = output
        .try_clone()
        .map_err(|_| "无法打开后端日志".to_string())?;
    let mut child = tokio::process::Command::new(hermes)
        .args(["serve", "--host", "127.0.0.1", "--port", "0", "--isolated"])
        .env("HERMES_HOME", storage.join("hermes-home"))
        .env(
            "HERMES_GATEWAY_LOCK_DIR",
            storage.join("control").join("gateway-locks"),
        )
        .env("HERMES_DESKTOP_READY_FILE", &ready)
        .env("HERMES_DESKTOP", "1")
        .env("HERMES_DASHBOARD_SESSION_TOKEN", &token)
        .env("HERMES_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(output))
        .stderr(Stdio::from(error))
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "后端启动失败".to_string())?;
    let pid = child.id().ok_or("无法获取后端 PID")?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let port = loop {
        if child
            .try_wait()
            .map_err(|_| "后端进程状态读取失败".to_string())?
            .is_some()
        {
            return Err("后端在发布就绪状态前退出；请查看 backend.log".into());
        }
        if let Ok(bytes) = fs::read(&ready) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(port) = value.get("port").and_then(|port| port.as_u64()) {
                    if let Ok(port) = u16::try_from(port) {
                        if port > 0 {
                            break port;
                        }
                    }
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("等待后端就绪超时".into());
        }
        sleep(Duration::from_millis(200)).await;
    };
    ping(port, &token).await?;
    if child
        .try_wait()
        .map_err(|_| "后端进程状态读取失败".to_string())?
        .is_some()
    {
        return Err("后端在鉴权后退出".into());
    }
    let gateway = GatewayClient::connect(port, &token, app).await?;
    let replay_epoch = gateway.replay_epoch.clone();
    *owned = Some(OwnedBackend {
        _storage_lock: storage_lock,
        child,
        port,
        token,
        gateway,
    });
    Ok(BackendInfo {
        port,
        pid,
        replay_epoch,
    })
}

#[tauri::command]
pub async fn ping_backend(state: State<'_, BackendState>) -> Result<(), String> {
    let mut owned = state.0.lock().await;
    let backend = owned.as_mut().ok_or("后端尚未启动")?;
    if backend
        .child
        .try_wait()
        .map_err(|_| "后端进程状态读取失败".to_string())?
        .is_some()
    {
        *owned = None;
        return Err("后端已退出".into());
    }
    ping(backend.port, &backend.token).await
}

#[tauri::command]
pub async fn reconnect_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
) -> Result<BackendInfo, String> {
    let mut owned = state.0.lock().await;
    let backend = owned.as_mut().ok_or("后端尚未启动")?;
    if backend
        .child
        .try_wait()
        .map_err(|_| "后端进程状态读取失败".to_string())?
        .is_some()
    {
        *owned = None;
        return Err("后端已退出，无法重连".into());
    }
    let replacement = GatewayClient::connect(backend.port, &backend.token, app).await?;
    std::mem::replace(&mut backend.gateway, replacement).close();
    Ok(BackendInfo {
        port: backend.port,
        pid: backend.child.id().unwrap_or(0),
        replay_epoch: backend.gateway.replay_epoch.clone(),
    })
}

#[tauri::command]
pub async fn stop_backend(state: State<'_, BackendState>) -> Result<(), String> {
    if let Some(mut backend) = state.0.lock().await.take() {
        backend.gateway.close();
        backend
            .child
            .start_kill()
            .map_err(|_| "停止本产品后端失败".to_string())?;
        timeout(Duration::from_secs(8), backend.child.wait())
            .await
            .map_err(|_| "等待后端退出超时".to_string())?
            .map_err(|_| "后端退出状态读取失败".to_string())?;
    }
    Ok(())
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
) -> Result<Value, String> {
    if session_id.is_empty() || session_id.len() > 256 {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request(
            "session.events.since",
            json!({"session_id":session_id,"last_seen":last_seen,"replay_epoch":replay_epoch}),
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::acquire_storage_lock;
    use std::fs;
    use std::process::Command;
    use uuid::Uuid;

    #[test]
    fn storage_lock_child() {
        let Ok(path) = std::env::var("HERMESS_TEST_STORAGE_LOCK_PATH") else {
            return;
        };
        let acquired = acquire_storage_lock(std::path::Path::new(&path)).is_ok();
        let expected =
            std::env::var("HERMESS_TEST_STORAGE_LOCK_AVAILABLE").unwrap_or_default() == "1";
        assert_eq!(acquired, expected);
    }

    fn check_child_lock(root: &std::path::Path, available: bool) {
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "backend::tests::storage_lock_child"])
            .env("HERMESS_TEST_STORAGE_LOCK_PATH", root)
            .env(
                "HERMESS_TEST_STORAGE_LOCK_AVAILABLE",
                if available { "1" } else { "0" },
            )
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "child lock check failed: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }

    #[test]
    fn storage_lock_rejects_second_owner_and_recovers_after_release() {
        let root = std::env::temp_dir().join(format!("hermess-storage-lock-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("control")).unwrap();
        let first = acquire_storage_lock(&root).unwrap();
        assert!(acquire_storage_lock(&root).is_err());
        check_child_lock(&root, false);
        drop(first);
        let second = acquire_storage_lock(&root).unwrap();
        drop(second);
        check_child_lock(&root, true);
        fs::remove_file(root.join("control").join("owner.lock")).unwrap();
        fs::remove_dir(root.join("control")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
