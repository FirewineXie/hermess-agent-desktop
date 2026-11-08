use crate::paths::{filesystem_path, plain_path, CanonicalizePlain};
pub mod about;
pub mod bots;
pub mod browser_bridge;
pub mod channel_manage;
pub mod channel_telegram;
pub mod channel_vendor_qr;
pub mod channel_whatsapp;
pub mod channels;
pub mod chat;
mod chat_create;
pub mod chat_rollback;
pub mod chat_subagents;
pub mod coding;
mod coding_catalog;
mod coding_command;
mod coding_config;
mod coding_context;
mod coding_images;
mod coding_permission_settings;
mod coding_permissions;
mod coding_projects;
pub mod coding_providers;
pub mod coding_runtime;
mod coding_settings;
mod coding_settings_files;
mod coding_settings_probe;
mod coding_validation;
mod coding_vault;
mod coding_worker;
mod composer_agents;
pub mod composer_background;
mod composer_branch;
mod composer_commands;
mod composer_policy;
mod composer_queue;
pub mod composer_side_question;
pub mod composer_steer;
mod composer_undo;
pub mod config;
mod config_document;
pub mod console_socket;
mod credential_pool;
pub mod curator;
pub mod dashboard_plugins;
pub mod delegation;
pub mod downloadable_tools;
mod env_keys;
pub mod extensions;
#[cfg(windows)]
mod first_run_install;
mod gateway_control;
mod gateway_recovery;
mod helper_python;
mod hermes_plugins;
mod hooks;
mod jobs;
pub mod kanban_dashboard;
mod local_http;
mod location;
mod logs;
mod managed_files;
mod mcp_registry;
pub mod media;
mod media_files;
mod media_protocol;
mod media_source;
pub mod memory_provider;
mod memory_provider_setup;
pub mod model_oauth;
pub mod models;
mod modelscope;
mod modelscope_mcp;
mod pairing;
mod payload;
pub mod personal_files;
pub mod personal_tasks;
pub mod personalities;
pub(crate) mod plugin_services;
#[cfg(windows)]
mod powershell_tool;
mod product_skill;
pub mod profile_archive;
pub(crate) mod profile_create_adapter;
pub mod profile_data;
pub mod profile_identity;
mod profile_scope;
pub mod profiles;
pub mod provider_copy;
mod remote_config;
pub mod remote_gateway;
#[cfg(windows)]
mod retired_payload;
pub mod security;
pub mod session_export;
mod session_management;
mod system_actions;
pub mod system_stats;
pub mod tools;
pub mod usage;
mod webhooks;
pub mod workbuddy_import;

use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use crate::gateway::GatewayClient;
use crate::process_manager::{self, ProcessRegistration};
use futures_util::{SinkExt, StreamExt};
#[cfg(test)]
use location::acquire_storage_lock;
use location::{save_storage_path, saved_storage_path};
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

#[derive(Default)]
pub struct BackendState(
    Mutex<Option<OwnedBackend>>,
    Mutex<()>,
    Mutex<Option<profile_scope::ProfileTopology>>,
    Mutex<HashMap<(String, String, String), Value>>,
    Mutex<()>,
    Mutex<Option<remote_gateway::ActiveRemote>>,
    gateway_recovery::RecoveryState,
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

#[derive(Clone, Serialize)]
pub struct BackendInfo {
    port: u16,
    pid: u32,
    replay_epoch: String,
}

impl BackendState {
    pub(crate) async fn validate_chat_window_profile(
        &self,
        profile: &str,
    ) -> Result<(), DesktopFailure> {
        self.resolve_chat_profile(profile).await.map(|_| ())
    }

    pub(crate) async fn chat_window_snapshot(
        &self,
    ) -> Result<Option<(BackendInfo, String)>, DesktopFailure> {
        let mut owned = self.0.lock().await;
        let Some(backend) = owned.as_mut() else {
            return Ok(None);
        };
        if !backend_running(backend).map_err(DesktopFailure::from)? || backend.gateway.is_closed() {
            return Ok(None);
        }
        Ok(Some((
            BackendInfo {
                port: backend.port,
                pid: backend.child.id().unwrap_or(0),
                replay_epoch: backend.gateway.replay_epoch.clone(),
            },
            plain_path(&backend.storage).to_string_lossy().into_owned(),
        )))
    }
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
    let python = std::env::var_os("HERMESS_DEV_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            build.join("hermes-venv-i1").join(if cfg!(windows) {
                "Scripts/python.exe"
            } else {
                "bin/python"
            })
        });
    let storage = std::env::var_os("HERMESS_DEV_STORAGE")
        .map(PathBuf::from)
        .unwrap_or_else(|| build.join("desktop-dev-data"));
    Ok(DevDefaults {
        python_path: python.to_string_lossy().into_owned(),
        storage_path: storage.to_string_lossy().into_owned(),
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
    let configured = std::env::var_os("HERMESS_DEV_PYTHON")
        .and_then(|value| PathBuf::from(value).canonicalize_plain().ok());
    if !python.starts_with(product.join(".build")) && configured.as_ref() != Some(&python) {
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
    gateway_recovery::start(
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
    let initialized = saved_storage_path(&app)?.is_some();
    let selected = location::selected_storage(&app)?;
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
    let hermes = validate_payload(&resource.join("runtime/payload"))?;
    if saved_storage_path(&app)?.is_none() {
        let resolved = selected
            .canonicalize_plain()
            .map_err(|_| "无法解析主要存储位置".to_string())?;
        save_storage_path(&app, &resolved)?;
    }
    let info = gateway_recovery::start(app, &state, hermes, selected.clone(), true)
        .await
        .map_err(DesktopFailure::from)?;
    #[cfg(windows)]
    retired_payload::schedule_cleanup(resource, selected.join("HermessAgentDesktop"));
    Ok(info)
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
    manual_retry: Option<bool>,
) -> Result<BackendInfo, DesktopFailure> {
    gateway_recovery::reconnect(app, &state, manual_retry.unwrap_or(false)).await
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
    whatsapp_setups: State<'_, channel_whatsapp::WhatsAppSetupState>,
) -> Result<GracefulRestartResult, DesktopFailure> {
    let mut cancellation = state.6.subscribe();
    let _lifecycle = state.6.gate.lock().await;
    if cancellation.has_changed().unwrap_or(true) {
        return Err(DesktopFailure::runtime_unavailable());
    }
    tokio::select! {
        biased;
        _ = cancellation.changed() => Err(DesktopFailure::runtime_unavailable()),
        result = restart_backend_gracefully_inner(app, &state, &whatsapp_setups) => result,
    }
}

async fn restart_backend_gracefully_inner(
    app: AppHandle,
    state: &State<'_, BackendState>,
    whatsapp_setups: &State<'_, channel_whatsapp::WhatsAppSetupState>,
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

    channel_whatsapp::cancel_all(&state, &whatsapp_setups).await;
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
    old._process
        .terminate_tree()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    old.gateway.confirm_process_stopped();
    old.gateway.close();
    drop(old);
    drop(owned);
    drop(drain_guard);

    let selected = storage
        .parent()
        .ok_or("无法定位网关存储目录")?
        .to_path_buf();
    let info = gateway_recovery::launch_owned(app, &state, hermes, selected, disable_lazy_installs)
        .await?;
    Ok(GracefulRestartResult::Restarted { info })
}

#[tauri::command]
pub async fn stop_backend(
    state: State<'_, BackendState>,
    browser_bridge: State<'_, browser_bridge::BrowserBridgeState>,
    whatsapp_setups: State<'_, channel_whatsapp::WhatsAppSetupState>,
) -> Result<(), DesktopFailure> {
    // Signal first: an in-flight startup/recovery must not delay an intentional stop.
    state.6.cancel();
    let _lifecycle = state.6.gate.lock().await;
    state.6.clear().await;
    // The browser's detach request needs the gateway, so end CDP first.
    browser_bridge.stop_all().await;
    channel_whatsapp::cancel_all(&state, &whatsapp_setups).await;
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
        backend
            ._process
            .terminate_tree()
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        backend.gateway.confirm_process_stopped();
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
