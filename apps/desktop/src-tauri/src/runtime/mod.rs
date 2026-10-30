use crate::paths::{filesystem_path, plain_path, CanonicalizePlain};
pub mod about;
pub mod browser_bridge;
pub mod channels;
pub mod chat;
mod composer_agents;
mod composer_branch;
mod composer_commands;
mod composer_policy;
mod composer_queue;
pub mod composer_side_question;
pub mod composer_steer;
mod composer_undo;
pub mod config;
mod config_document;
pub mod delegation;
pub mod downloadable_tools;
pub mod extensions;
mod gateway_control;
mod helper_python;
mod hermes_plugins;
mod jobs;
mod location;
mod mcp_registry;
pub mod memory_provider;
pub mod models;
mod modelscope;
mod modelscope_mcp;
mod payload;
pub mod personal_files;
pub mod personalities;
#[cfg(windows)]
mod powershell_tool;
mod product_skill;
pub mod profile_data;
mod profile_scope;
pub mod profiles;
pub mod provider_copy;
#[cfg(windows)]
mod retired_payload;
pub mod security;
pub mod session_export;
pub mod tools;
pub mod usage;
pub mod workbuddy_import;

use crate::diagnostics::{append_client_event, capture_backend_output};
use crate::errors::DesktopFailure;
use crate::gateway::GatewayClient;
use crate::process_manager::{self, ProcessRegistration};
use futures_util::{SinkExt, StreamExt};
use location::{acquire_storage_lock, save_storage_path, saved_storage_path};
use payload::validate_payload;
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    process::Child,
    sync::Mutex,
    time::{sleep, timeout, Instant},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};
use uuid::Uuid;

#[derive(Default)]
pub struct BackendState(
    Mutex<Option<OwnedBackend>>,
    Mutex<()>,
    Mutex<Option<profile_scope::ProfileTopology>>,
    Mutex<HashMap<(String, String, String), Value>>,
    Mutex<()>,
);

struct OwnedBackend {
    _storage_lock: fs::File,
    storage: PathBuf,
    child: Child,
    _process: ProcessRegistration,
    port: u16,
    token: String,
    hermes: PathBuf,
    endpoint: serde_json::Value,
    gateway: Arc<GatewayClient>,
    selected_profile: String,
    bundled_tools_root: Option<PathBuf>,
    disable_lazy_installs: bool,
    exit_recorded: bool,
}

struct RestartDrainGuard(PathBuf);

impl Drop for RestartDrainGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(filesystem_path(&self.0));
    }
}

#[derive(Serialize)]
pub struct BackendInfo {
    port: u16,
    pid: u32,
    replay_epoch: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum GracefulRestartResult {
    Restarted { info: BackendInfo },
    Deferred,
}

#[derive(Serialize)]
pub struct DevDefaults {
    python_path: String,
    storage_path: String,
}

#[derive(Serialize)]
pub struct PackedDefaults {
    storage_path: String,
    initialized: bool,
}

#[derive(Serialize)]
pub struct BundledTool {
    name: String,
    version: String,
    path: String,
    present: bool,
}

#[derive(Serialize)]
pub struct BundledToolsInventory {
    has_manifest: bool,
    tools: Vec<BundledTool>,
}

#[tauri::command]
pub fn dev_backend_defaults() -> Result<DevDefaults, DesktopFailure> {
    if !cfg!(debug_assertions) {
        return Err("仅调试构建可用".into());
    }
    let product = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_plain()
        .map_err(|_| "无法定位产品目录".to_string())?;
    let build = product.join(".build");
    let python = build.join("hermes-venv-i1").join(if cfg!(windows) {
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

fn hermes_process_path(path: &Path) -> PathBuf {
    plain_path(path)
}

pub(crate) fn existing_client_log_storage(app: &AppHandle) -> Option<PathBuf> {
    let selected = if cfg!(debug_assertions) {
        PathBuf::from(dev_backend_defaults().ok()?.storage_path)
    } else {
        saved_storage_path(app).ok()??
    };
    crate::storage::product_storage(&selected).ok()
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

async fn verify_private_api(port: u16, token: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|_| "无法检查桌面私有接口".to_string())?;
    let root = client
        .get(format!("http://127.0.0.1:{port}/"))
        .send()
        .await
        .map_err(|_| "无法检查桌面私有接口".to_string())?;
    if root.status() != reqwest::StatusCode::NOT_FOUND {
        return Err("后端公开了桌面私有入口".into());
    }
    let mut browser = format!("ws://127.0.0.1:{port}/api/ws?token={token}")
        .into_client_request()
        .map_err(|_| "无法检查 WebSocket 浏览器隔离".to_string())?;
    browser
        .headers_mut()
        .insert("origin", HeaderValue::from_static("http://127.0.0.1"));
    match timeout(Duration::from_secs(5), connect_async(browser)).await {
        Ok(Err(tokio_tungstenite::tungstenite::Error::Http(response)))
            if response.status() == 403 =>
        {
            Ok(())
        }
        _ => Err("后端未拒绝浏览器 WebSocket 握手".into()),
    }
}

async fn discover_owned_gateway(
    home: &Path,
    launched_pid: u32,
) -> Result<Option<(u16, serde_json::Value)>, String> {
    gateway_control::discover(home, launched_pid).await
}

async fn mint_gateway_ticket(
    home: &Path,
    endpoint: &serde_json::Value,
    launched_pid: u32,
) -> Result<String, String> {
    gateway_control::ticket(home, endpoint, launched_pid).await
}

#[tauri::command]
pub async fn start_dev_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
    python_path: String,
    storage_path: String,
) -> Result<BackendInfo, DesktopFailure> {
    if !cfg!(debug_assertions) {
        return Err("开发态后端启动仅在调试构建可用".into());
    }
    let python = PathBuf::from(python_path)
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::invalid_input())?;
    let product = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_plain()
        .map_err(|_| "无法定位产品目录".to_string())?;
    if !python.starts_with(product.join(".build")) {
        return Err(DesktopFailure::invalid_input());
    }
    let hermes = python.with_file_name(if cfg!(windows) {
        "hermes.exe"
    } else {
        "hermes"
    });
    if !hermes.is_file() {
        return Err(DesktopFailure::runtime_unavailable());
    }
    launch_backend(
        app,
        &state,
        hermes,
        plain_path(Path::new(&storage_path)),
        false,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub fn packed_backend_defaults(app: AppHandle) -> Result<PackedDefaults, DesktopFailure> {
    if cfg!(debug_assertions) {
        return Err("打包配置仅在发行构建可用".into());
    }
    let saved = saved_storage_path(&app)?;
    let initialized = saved.is_some();
    let selected = match saved {
        Some(path) => path,
        None => app
            .path()
            .app_local_data_dir()
            .map(|path| plain_path(&path))
            .map_err(|_| "无法定位默认数据目录".to_string())?,
    };
    Ok(PackedDefaults {
        storage_path: selected.to_string_lossy().into_owned(),
        initialized,
    })
}

#[tauri::command]
pub async fn start_packed_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
    storage_path: String,
) -> Result<BackendInfo, DesktopFailure> {
    if cfg!(debug_assertions) {
        return Err("内置运行时入口仅供打包构建使用".into());
    }
    let resource = app
        .path()
        .resource_dir()
        .map(|path| plain_path(&path))
        .map_err(|_| "无法定位应用资源目录".to_string())?;
    let selected = plain_path(Path::new(&storage_path));
    if let Some(saved) = saved_storage_path(&app)? {
        if !saved.exists() {
            return Err(DesktopFailure::runtime_unavailable());
        }
        if saved
            .canonicalize_plain()
            .map_err(|_| "无法解析已选存储位置".to_string())?
            != selected
                .canonicalize_plain()
                .map_err(|_| "主要存储位置与已保存位置不一致".to_string())?
        {
            return Err(DesktopFailure::conflict());
        }
    }
    if !selected.is_absolute() {
        return Err(DesktopFailure::invalid_input());
    }
    {
        let mut owned = state.0.lock().await;
        if let Some(info) = reuse_owned_backend(&mut owned, app.clone(), &selected).await? {
            return Ok(info);
        }
    }
    let hermes = validate_payload(&resource.join("runtime/payload"))?;
    if saved_storage_path(&app)?.is_none() {
        let resolved = selected
            .canonicalize_plain()
            .map_err(|_| "无法解析主要存储位置".to_string())?;
        save_storage_path(&app, &resolved)?;
    }
    let info = launch_backend(app, &state, hermes, selected.clone(), true)
        .await
        .map_err(DesktopFailure::from)?;
    #[cfg(windows)]
    retired_payload::schedule_cleanup(resource, selected.join("HermessAgentDesktop"));
    Ok(info)
}

async fn launch_backend(
    app: AppHandle,
    state: &BackendState,
    hermes: PathBuf,
    selected: PathBuf,
    disable_lazy_installs: bool,
) -> Result<BackendInfo, DesktopFailure> {
    if !selected.is_absolute() {
        return Err(DesktopFailure::invalid_input());
    }
    let mut owned = state.0.lock().await;
    if let Some(info) = reuse_owned_backend(&mut owned, app.clone(), &selected).await? {
        return Ok(info);
    }
    fs::create_dir_all(filesystem_path(&selected)).map_err(|_| "无法创建存储位置".to_string())?;
    let storage = selected
        .canonicalize_plain()
        .map_err(|_| "无法解析存储位置".to_string())?
        .join("HermessAgentDesktop");
    fs::create_dir_all(filesystem_path(&storage.join("control")))
        .map_err(|_| "无法创建产品控制目录".to_string())?;
    let storage = storage
        .canonicalize_plain()
        .map_err(|_| "无法解析产品存储目录".to_string())?;
    let storage_lock = acquire_storage_lock(&storage)?;
    crate::diagnostics::set_client_log_storage(storage.clone());
    #[cfg(windows)]
    {
        let _ = append_client_event(&storage, "powershell_tool_install_start");
        if let Err(error) = powershell_tool::install(&storage) {
            let _ = append_client_event(
                &storage,
                &format!("powershell_tool_install_failed error={error}"),
            );
            return Err(error.into());
        }
        let _ = append_client_event(&storage, "powershell_tool_install_completed");
    }
    let _ = append_client_event(&storage, "product_skill_install_start");
    if let Err(error) = product_skill::install(&storage) {
        let _ = append_client_event(&storage, "product_skill_install_failed");
        return Err(error.into());
    }
    let _ = append_client_event(&storage, "product_skill_install_completed");
    let _ = append_client_event(&storage, "backend_starting");
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let bundled_tools_root = hermes.parent().and_then(Path::parent).and_then(|root| {
        root.join("manifest.json")
            .is_file()
            .then(|| root.join("tools"))
    });
    let hermes_home = storage.join("hermes-home");
    let gateway_locks = storage.join("control").join("gateway-locks");
    let gateway_home = hermes_process_path(&hermes_home);
    let mut command = tokio::process::Command::new(&hermes);
    command
        .args(["gateway", "run"])
        .env("HERMES_HOME", &gateway_home)
        .env(
            "HERMES_GATEWAY_LOCK_DIR",
            hermes_process_path(&gateway_locks),
        )
        .env("HERMES_DESKTOP", "1")
        .env("HERMESS_DESKTOP_PRIVATE_API", "1")
        .env("HERMES_DASHBOARD_SESSION_TOKEN", &token)
        .env("HERMES_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if disable_lazy_installs {
        command.env("HERMES_DISABLE_LAZY_INSTALLS", "1");
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let (mut child, registration) =
        process_manager::spawn(&mut command, "gateway").map_err(|_| "后端启动失败".to_string())?;
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(capture_backend_output(storage.clone(), stdout, "stdout"));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(capture_backend_output(storage.clone(), stderr, "stderr"));
    }
    let pid = child.id().ok_or("无法获取后端 PID")?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let (port, endpoint) = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "后端进程状态读取失败".to_string())?
        {
            let _ = append_client_event(
                &storage,
                &format!("ERROR backend_exited_before_ready status={status}"),
            );
            return Err("后端在发布就绪状态前退出；请查看开发者诊断中的 Hermess 日志".into());
        }
        if hermes_home.join("gateway.lock").is_file() {
            if let Some(found) = discover_owned_gateway(&gateway_home, pid).await? {
                break found;
            }
        }
        if Instant::now() >= deadline {
            return Err("等待后端就绪超时".into());
        }
        sleep(Duration::from_millis(200)).await;
    };
    ping(port, &token).await?;
    verify_private_api(port, &token).await?;
    if let Some(status) = child
        .try_wait()
        .map_err(|_| "后端进程状态读取失败".to_string())?
    {
        let _ = append_client_event(
            &storage,
            &format!("ERROR backend_exited_after_auth status={status}"),
        );
        return Err("后端在鉴权后退出".into());
    }
    let ticket = mint_gateway_ticket(&gateway_home, &endpoint, pid).await?;
    let gateway = Arc::new(GatewayClient::connect(port, &ticket, app).await?);
    let selected_profile =
        profiles::restore_selected_profile(&storage, &gateway, child.id(), port, &token).await;
    let replay_epoch = gateway.replay_epoch.clone();
    let _ = append_client_event(&storage, "backend_ready");
    *owned = Some(OwnedBackend {
        _storage_lock: storage_lock,
        storage,
        child,
        _process: registration,
        port,
        token,
        hermes,
        endpoint,
        gateway,
        selected_profile,
        bundled_tools_root,
        disable_lazy_installs,
        exit_recorded: false,
    });
    Ok(BackendInfo {
        port,
        pid,
        replay_epoch,
    })
}

async fn reuse_owned_backend(
    owned: &mut Option<OwnedBackend>,
    app: AppHandle,
    selected: &Path,
) -> Result<Option<BackendInfo>, DesktopFailure> {
    if let Some(existing) = owned.as_mut() {
        if backend_running(existing).map_err(DesktopFailure::from)? {
            if !running_storage_matches(&existing.storage, selected) {
                return Err(DesktopFailure::conflict());
            }
            if existing.gateway.is_closed() {
                let ticket = mint_gateway_ticket(
                    &existing.storage.join("hermes-home"),
                    &existing.endpoint,
                    existing.child.id().ok_or("自有网关 PID 丢失")?,
                )
                .await?;
                existing.gateway =
                    Arc::new(GatewayClient::connect(existing.port, &ticket, app).await?);
            }
            return Ok(Some(BackendInfo {
                port: existing.port,
                pid: existing.child.id().unwrap_or(0),
                replay_epoch: existing.gateway.replay_epoch.clone(),
            }));
        }
        *owned = None;
    }
    Ok(None)
}

fn backend_running(backend: &mut OwnedBackend) -> Result<bool, String> {
    match backend
        .child
        .try_wait()
        .map_err(|_| "后端进程状态读取失败".to_string())?
    {
        None => Ok(true),
        Some(status) => {
            if !backend.exit_recorded {
                let _ = append_client_event(
                    &backend.storage,
                    &format!("ERROR backend_exited status={status}"),
                );
                backend.exit_recorded = true;
            }
            Ok(false)
        }
    }
}

fn running_storage_matches(storage: &Path, selected: &Path) -> bool {
    selected.canonicalize_plain().ok().as_deref() == storage.parent()
}

#[tauri::command]
pub async fn ping_backend(state: State<'_, BackendState>) -> Result<(), DesktopFailure> {
    let mut owned = state.0.lock().await;
    let backend = owned
        .as_mut()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    if !backend_running(backend).map_err(DesktopFailure::from)? {
        *owned = None;
        return Err(DesktopFailure::runtime_unavailable());
    }
    ping(backend.port, &backend.token)
        .await
        .map_err(|_| DesktopFailure::connection_lost())
}

#[tauri::command]
pub async fn reconnect_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
) -> Result<BackendInfo, DesktopFailure> {
    let mut owned = state.0.lock().await;
    let backend = owned
        .as_mut()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    if !backend_running(backend).map_err(DesktopFailure::from)? {
        *owned = None;
        return Err(DesktopFailure::runtime_unavailable());
    }
    let ticket = mint_gateway_ticket(
        &backend.storage.join("hermes-home"),
        &backend.endpoint,
        backend.child.id().ok_or("自有网关 PID 丢失")?,
    )
    .await?;
    let replacement = Arc::new(
        GatewayClient::connect(backend.port, &ticket, app)
            .await
            .map_err(|_| DesktopFailure::connection_lost())?,
    );
    std::mem::replace(&mut backend.gateway, replacement).close();
    Ok(BackendInfo {
        port: backend.port,
        pid: backend.child.id().unwrap_or(0),
        replay_epoch: backend.gateway.replay_epoch.clone(),
    })
}

async fn restart_status(client: &Client, port: u16) -> Result<Value, DesktopFailure> {
    let response = client
        .get(format!("http://127.0.0.1:{port}/api/status"))
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    if !response.status().is_success() {
        return Err(DesktopFailure::connection_lost());
    }
    response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn restart_backend_gracefully(
    app: AppHandle,
    state: State<'_, BackendState>,
) -> Result<GracefulRestartResult, DesktopFailure> {
    let _restart_gate = state.1.try_lock().map_err(|_| DesktopFailure::conflict())?;
    let (pid, port, token, hermes, storage, disable_lazy_installs) = {
        let mut owned = state.0.lock().await;
        let backend = owned
            .as_mut()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        if backend
            .child
            .try_wait()
            .map_err(|_| "无法读取网关进程状态".to_string())?
            .is_some()
        {
            return Err(DesktopFailure::runtime_unavailable());
        }
        (
            backend.child.id().ok_or("无法读取网关 PID")?,
            backend.port,
            backend.token.clone(),
            backend.hermes.clone(),
            backend.storage.clone(),
            backend.disable_lazy_installs,
        )
    };
    let home = storage.join("hermes-home");
    let drain_marker = home.join(".drain_request.json");
    if drain_marker.exists() {
        return Err("网关已在等待停止，请稍后再试".into());
    }
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let initial = restart_status(&client, port).await?;
    if initial.get("gateway_running").and_then(Value::as_bool) != Some(true)
        || !matches!(
            initial.get("gateway_state").and_then(Value::as_str),
            Some("running" | "degraded")
        )
    {
        return Err("网关不在可重启状态".into());
    }
    // The guard removes our reversible drain request if polling, stopping, or the
    // Tauri command itself fails. Keep the old gateway alive on a timeout.
    let drain_guard = RestartDrainGuard(drain_marker);
    let response = client
        .post(format!("http://127.0.0.1:{port}/api/gateway/drain"))
        .header("X-Hermes-Session-Token", &token)
        .json(&serde_json::json!({"action":"drain","suppress_notification":true}))
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let status = restart_status(&client, port).await?;
        if status.get("gateway_running").and_then(Value::as_bool) != Some(true) {
            return Err(DesktopFailure::connection_lost());
        }
        if status.get("gateway_state").and_then(Value::as_str) == Some("draining")
            && status.get("active_agents").and_then(Value::as_u64) == Some(0)
        {
            break;
        }
        if Instant::now() >= deadline {
            return Ok(GracefulRestartResult::Deferred);
        }
        sleep(Duration::from_secs(1)).await;
    }

    let mut owned = state.0.lock().await;
    let backend = owned
        .as_mut()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    if backend.child.id() != Some(pid)
        || backend
            .child
            .try_wait()
            .map_err(|_| "无法读取网关进程状态".to_string())?
            .is_some()
    {
        return Err("等待期间网关进程已改变，已取消重启".into());
    }
    let mut stop = tokio::process::Command::new(&hermes);
    stop.args(["gateway", "stop"])
        .env("HERMES_HOME", hermes_process_path(&home))
        .env(
            "HERMES_GATEWAY_LOCK_DIR",
            hermes_process_path(&storage.join("control").join("gateway-locks")),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    stop.creation_flags(0x08000000);
    let (mut helper, _stop_registration) = process_manager::spawn(&mut stop, "gateway_stop")
        .map_err(|_| "无法启动网关停止命令".to_string())?;
    let exit = timeout(Duration::from_secs(60), helper.wait())
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| "无法读取网关停止结果".to_string())?;
    if !exit.success() {
        return Ok(GracefulRestartResult::Deferred);
    }
    timeout(Duration::from_secs(60), backend.child.wait())
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| "无法等待旧网关退出".to_string())?;
    let old = owned
        .take()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    old.gateway.close();
    drop(old);
    drop(owned);
    drop(drain_guard);

    let selected = storage
        .parent()
        .ok_or("无法定位网关存储目录")?
        .to_path_buf();
    let info = launch_backend(app, &state, hermes, selected, disable_lazy_installs).await?;
    Ok(GracefulRestartResult::Restarted { info })
}

#[tauri::command]
pub async fn stop_backend(
    state: State<'_, BackendState>,
    browser_bridge: State<'_, browser_bridge::BrowserBridgeState>,
) -> Result<(), DesktopFailure> {
    // The browser's detach request needs the gateway, so end CDP first.
    browser_bridge.stop_all().await;
    let mut owned = state.0.lock().await;
    if let Some(backend) = owned.as_mut() {
        let _ = append_client_event(&backend.storage, "backend_stopping");
        if backend
            .child
            .try_wait()
            .map_err(|_| "后端进程状态读取失败".to_string())?
            .is_none()
        {
            let mut stop = tokio::process::Command::new(&backend.hermes);
            stop.args(["gateway", "stop"])
                .env(
                    "HERMES_HOME",
                    hermes_process_path(&backend.storage.join("hermes-home")),
                )
                .env(
                    "HERMES_GATEWAY_LOCK_DIR",
                    hermes_process_path(&backend.storage.join("control").join("gateway-locks")),
                )
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            stop.creation_flags(0x08000000);
            if let Ok((mut helper, _stop_registration)) =
                process_manager::spawn_shutdown(&mut stop, "gateway_stop")
            {
                let _ = timeout(Duration::from_secs(8), helper.wait()).await;
            }
            if timeout(Duration::from_secs(5), backend.child.wait())
                .await
                .is_err()
            {
                backend
                    .child
                    .start_kill()
                    .map_err(|_| "停止本产品后端失败".to_string())?;
            }
        }
        timeout(Duration::from_secs(8), backend.child.wait())
            .await
            .map_err(|_| DesktopFailure::timeout())?
            .map_err(|_| "后端退出状态读取失败".to_string())?;
        let _ = append_client_event(&backend.storage, "backend_stopped");
    }
    if let Some(backend) = owned.take() {
        backend.gateway.close();
    }
    drop(owned);
    Ok(())
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;

impl BackendState {
    pub(crate) async fn owned_process_running(&self) -> bool {
        self.0
            .lock()
            .await
            .as_mut()
            .is_some_and(|backend| backend_running(backend).unwrap_or(false))
    }
}
