//! Recovery of the desktop-owned Gateway. Lifecycle entrypoints share one gate.
use super::location::acquire_storage_lock;
#[cfg(windows)]
use super::powershell_tool;
use super::{
    backend_running, discover_owned_gateway, hermes_process_path, mint_gateway_ticket, ping,
    product_skill, profiles, running_storage_matches, verify_private_api, BackendInfo,
    BackendState, OwnedBackend,
};
use crate::diagnostics::{append_client_event, capture_backend_output};
use crate::errors::DesktopFailure;
use crate::gateway::GatewayClient;
use crate::paths::{filesystem_path, CanonicalizePlain};
use crate::process_manager;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::AppHandle;
use tokio::{
    sync::{watch, Mutex, MutexGuard},
    time::{sleep, timeout, timeout_at, Instant},
};
use uuid::Uuid;

#[derive(Clone)]
struct LaunchConfig {
    hermes: PathBuf,
    selected: PathBuf,
    disable_lazy_installs: bool,
}

pub(super) struct RecoveryState {
    pub(super) gate: Mutex<()>,
    cancellation: watch::Sender<u64>,
    enabled: AtomicBool,
    saved: Mutex<Option<LaunchConfig>>,
    last_restart: Mutex<Option<Instant>>,
}

impl Default for RecoveryState {
    fn default() -> Self {
        Self {
            gate: Mutex::new(()),
            cancellation: watch::channel(0).0,
            enabled: AtomicBool::new(false),
            saved: Mutex::new(None),
            last_restart: Mutex::new(None),
        }
    }
}

impl RecoveryState {
    async fn recovery_gate(
        &self,
        cancellation: &mut watch::Receiver<u64>,
        deadline: Instant,
        operation: Uuid,
    ) -> Result<MutexGuard<'_, ()>, DesktopFailure> {
        tokio::select! {
            biased;
            _ = cancellation.changed() => {
                crate::diagnostics::log_client_event(&format!("gateway_recovery_cancelled operation={operation} stage=lifecycle_gate"));
                Err(DesktopFailure::runtime_unavailable())
            }
            gate = timeout_at(deadline, self.gate.lock()) => gate.map_err(|_| {
                crate::diagnostics::log_client_event(&format!("ERROR gateway_recovery_gate_timeout operation={operation}"));
                DesktopFailure::timeout()
            }),
        }
    }

    pub(super) fn subscribe(&self) -> watch::Receiver<u64> {
        self.cancellation.subscribe()
    }

    pub(super) fn cancel(&self) {
        self.enabled.store(false, Ordering::Release);
        self.interrupt();
    }

    pub(super) fn interrupt(&self) {
        self.cancellation
            .send_modify(|generation| *generation = generation.wrapping_add(1));
    }

    pub(super) async fn clear(&self) {
        self.saved.lock().await.take();
        self.last_restart.lock().await.take();
    }
}

const RESTART_WINDOW: Duration = Duration::from_secs(60);
const RECONNECT_GRACE: Duration = Duration::from_secs(5);
const RECONNECT_INTERVAL: Duration = Duration::from_millis(200);
const PROCESS_EXIT_TIMEOUT: Duration = Duration::from_secs(5);

fn reserve_restart(last_restart: &mut Option<Instant>, now: Instant) -> bool {
    if last_restart.is_some_and(|last| now.duration_since(last) < RESTART_WINDOW) {
        return false;
    }
    *last_restart = Some(now);
    true
}

pub(super) async fn start(
    app: AppHandle,
    state: &BackendState,
    hermes: PathBuf,
    selected: PathBuf,
    disable_lazy_installs: bool,
) -> Result<BackendInfo, DesktopFailure> {
    let mut cancellation = state.6.subscribe();
    let _gate = state.6.gate.lock().await;
    if cancellation.has_changed().unwrap_or(true) {
        return Err(DesktopFailure::runtime_unavailable());
    }
    if !selected.is_absolute() {
        return Err(DesktopFailure::invalid_input());
    }
    {
        let owned = state.0.lock().await;
        if owned
            .as_ref()
            .is_some_and(|backend| !running_storage_matches(&backend.storage, &selected))
        {
            return Err(DesktopFailure::conflict());
        }
    }
    state.6.enabled.store(true, Ordering::Release);
    state.6.last_restart.lock().await.take();
    *state.6.saved.lock().await = Some(LaunchConfig {
        hermes: hermes.clone(),
        selected: selected.clone(),
        disable_lazy_installs,
    });
    let storage = selected.join("HermessAgentDesktop");
    let result = tokio::select! {
        biased;
        _ = cancellation.changed() => {
            let _ = append_client_event(&storage, "gateway_start_cancelled");
            return Err(DesktopFailure::runtime_unavailable());
        },
        result = launch_owned(app, state, hermes, selected, disable_lazy_installs, None) => result,
    };
    if let Err(error) = &result {
        let _ = append_client_event(
            &storage,
            &format!(
                "ERROR gateway_start_failed error={}",
                serde_json::to_string(error).unwrap_or_default()
            ),
        );
    }
    result
}

pub(super) async fn reconnect(
    app: AppHandle,
    state: &BackendState,
    manual_retry: bool,
) -> Result<BackendInfo, DesktopFailure> {
    let deadline = Instant::now() + RESTART_WINDOW;
    let operation = Uuid::new_v4();
    let mut cancellation = state.6.subscribe();
    let _gate = state
        .6
        .recovery_gate(&mut cancellation, deadline, operation)
        .await?;
    let recovery = async {
        if !state.6.enabled.load(Ordering::Acquire) {
            return Err(DesktopFailure::runtime_unavailable());
        }
        if state.5.lock().await.is_some() {
            return Err(DesktopFailure::conflict());
        }
        if manual_retry {
            state.6.last_restart.lock().await.take();
        }
        let config = state
            .6
            .saved
            .lock()
            .await
            .clone()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        let _ = append_client_event(
            &config.selected.join("HermessAgentDesktop"),
            &format!("gateway_recovery_started operation={operation} manual={manual_retry}"),
        );
        recover(app, state, config, operation).await
    };
    let result = tokio::select! {
        biased;
        _ = cancellation.changed() => {
            crate::diagnostics::log_client_event(&format!("gateway_recovery_cancelled operation={operation}"));
            return Err(DesktopFailure::runtime_unavailable());
        }
        result = timeout_at(deadline, recovery) => match result {
            Ok(result) => result,
            Err(_) => {
                crate::diagnostics::log_client_event(&format!("ERROR gateway_recovery_timeout operation={operation}"));
                Err(DesktopFailure::timeout())
            }
        },
    };
    let outcome = match &result {
        Ok(info) => format!(
            "gateway_recovery_completed operation={operation} pid={} port={}",
            info.pid, info.port
        ),
        Err(error) => format!(
            "ERROR gateway_recovery_failed operation={operation} error={}",
            serde_json::to_string(error).unwrap_or_default()
        ),
    };
    crate::diagnostics::log_client_event(&outcome);
    result
}

async fn recover(
    app: AppHandle,
    state: &BackendState,
    config: LaunchConfig,
    operation: Uuid,
) -> Result<BackendInfo, DesktopFailure> {
    {
        let mut owned = state.0.lock().await;
        if let Some(backend) = owned.as_mut() {
            if backend_running(backend).map_err(DesktopFailure::from)? {
                let _ = append_client_event(
                    &backend.storage,
                    &format!(
                        "gateway_recovery_reconnecting operation={operation} pid={}",
                        backend.child.id().unwrap_or(0)
                    ),
                );
                let deadline = Instant::now() + RECONNECT_GRACE;
                loop {
                    match timeout_at(deadline, reconnect_owned(backend, app.clone())).await {
                        Ok(Ok(info)) => return Ok(info),
                        Ok(Err(_)) if Instant::now() < deadline => {}
                        _ => break,
                    }
                    if !backend_running(backend).map_err(DesktopFailure::from)? {
                        break;
                    }
                    sleep(
                        RECONNECT_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
                    )
                    .await;
                    if Instant::now() >= deadline {
                        break;
                    }
                }
                let _ = append_client_event(
                    &backend.storage,
                    &format!(
                        "ERROR gateway_recovery_reconnect_failed operation={operation} grace_ms={}",
                        RECONNECT_GRACE.as_millis()
                    ),
                );
            } else {
                let _ = append_client_event(
                    &backend.storage,
                    &format!("gateway_recovery_owned_process_exited operation={operation}"),
                );
            }
        }
        // Reserve before terminating anything. A repeated automatic recovery must
        // leave the current owned process available for an explicit manual retry.
        if !reserve_restart(&mut *state.6.last_restart.lock().await, Instant::now()) {
            let _ = append_client_event(
                &config.selected.join("HermessAgentDesktop"),
                &format!("ERROR gateway_recovery_restart_limit operation={operation}"),
            );
            return Err(DesktopFailure::runtime_unavailable());
        }
        if let Some(backend) = owned.as_mut() {
            let pid = backend.child.id().unwrap_or(0);
            let _ = append_client_event(
                &backend.storage,
                &format!("gateway_recovery_cleanup_started operation={operation} pid={pid}"),
            );
            backend.gateway.disable_events();
            backend.gateway.close();
            // Reap the child while the manager waits for the tree. On macOS a
            // zombie group leader can otherwise keep kill(-pgid, 0) successful.
            let (terminated, reaped) = tokio::join!(
                backend._process.terminate_tree(),
                timeout(PROCESS_EXIT_TIMEOUT, backend.child.wait()),
            );
            if terminated.is_err() {
                let _ = append_client_event(&backend.storage, &format!(
                    "ERROR gateway_recovery_cleanup_failed operation={operation} stage=process_tree pid={pid}"));
                return Err(DesktopFailure::operation_failed());
            }
            if !matches!(reaped, Ok(Ok(_))) {
                let _ = append_client_event(&backend.storage, &format!(
                    "ERROR gateway_recovery_cleanup_failed operation={operation} stage=child_exit pid={pid}"));
                return Err(DesktopFailure::timeout());
            }
            let _ = append_client_event(
                &backend.storage,
                &format!("gateway_recovery_cleanup_completed operation={operation} pid={pid}"),
            );
            backend.gateway.confirm_process_stopped();
        }
        // Reap our registration before relaunching. A lock or matching port alone
        // never authorizes attaching to a replacement PID created by somebody else.
        owned.take();
    }
    let _ = append_client_event(
        &config.selected.join("HermessAgentDesktop"),
        &format!("gateway_recovery_relaunching operation={operation} attempt=1"),
    );
    launch_owned(
        app,
        state,
        config.hermes,
        config.selected,
        config.disable_lazy_installs,
        None,
    )
    .await
}

async fn reconnect_owned(
    backend: &mut OwnedBackend,
    app: AppHandle,
) -> Result<BackendInfo, DesktopFailure> {
    let pid = backend
        .child
        .id()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    let home = backend.storage.join("hermes-home");
    let (port, endpoint) = discover_owned_gateway(&home, pid)
        .await?
        .ok_or_else(DesktopFailure::connection_lost)?;
    if port == backend.port && endpoint == backend.endpoint && !backend.gateway.is_closed() {
        let result = backend
            .gateway
            .request("ping", serde_json::json!({}))
            .await?;
        if result.get("pong").and_then(serde_json::Value::as_bool) == Some(true) {
            return Ok(BackendInfo {
                port,
                pid,
                replay_epoch: backend.gateway.replay_epoch.clone(),
            });
        }
        return Err(DesktopFailure::connection_lost());
    }
    let ticket = mint_gateway_ticket(&home, &endpoint, pid).await?;
    let replacement = Arc::new(
        GatewayClient::connect(port, &ticket, app, &home)
            .await
            .map_err(|_| DesktopFailure::connection_lost())?,
    );
    replacement.inherit_activity(&backend.gateway);
    std::mem::replace(&mut backend.gateway, replacement).close();
    backend.port = port;
    backend.endpoint = endpoint;
    Ok(BackendInfo {
        port,
        pid,
        replay_epoch: backend.gateway.replay_epoch.clone(),
    })
}

pub(super) async fn launch_owned(
    app: AppHandle,
    state: &BackendState,
    hermes: PathBuf,
    selected: PathBuf,
    disable_lazy_installs: bool,
    webapp: Option<super::web_access::ManagedWebapp>,
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
    if disable_lazy_installs {
        super::first_run_install::ensure(&hermes, &storage).await?;
    }
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
    let bundled_tools_root = hermes.parent().and_then(Path::parent).and_then(|root| {
        root.join("manifest.json")
            .is_file()
            .then(|| root.join("tools"))
    });
    let SpawnedGateway {
        child,
        registration,
        port,
        token,
        endpoint,
    } = spawn_owned_gateway(&hermes, &storage, disable_lazy_installs, webapp.as_ref()).await?;
    let pid = child.id().ok_or("无法获取后端 PID")?;
    let gateway_home = storage.join("hermes-home");
    let ticket = mint_gateway_ticket(&gateway_home, &endpoint, pid).await?;
    let gateway = Arc::new(GatewayClient::connect(port, &ticket, app, &gateway_home).await?);
    let selected_profile =
        profiles::restore_selected_profile(&storage, &gateway, child.id(), port, &token).await;
    let replay_epoch = gateway.replay_epoch.clone();
    let _ = append_client_event(&storage, "backend_ready");
    *owned = Some(OwnedBackend {
        web_access: None,
        webapp,
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
                reconnect_owned(existing, app).await?;
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

#[cfg(test)]
#[path = "tests/gateway_recovery.rs"]
mod tests;

struct SpawnedGateway {
    child: tokio::process::Child,
    registration: process_manager::ProcessRegistration,
    port: u16,
    token: String,
    endpoint: serde_json::Value,
}

async fn spawn_owned_gateway(
    hermes: &Path,
    storage: &Path,
    disable_lazy_installs: bool,
    webapp: Option<&super::web_access::ManagedWebapp>,
) -> Result<SpawnedGateway, DesktopFailure> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hermes_home = storage.join("hermes-home");
    let gateway_locks = storage.join("control").join("gateway-locks");
    let gateway_home = hermes_process_path(&hermes_home);
    let mut command = tokio::process::Command::new(&hermes);
    command
        .args(["gateway", "run", "--external-supervisor"])
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
    if let Some(webapp) = webapp {
        command.env("HERMES_MANAGED_DIR", webapp.path());
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let (mut child, registration) =
        process_manager::spawn(&mut command, "gateway").map_err(|_| "后端启动失败".to_string())?;
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(capture_backend_output(
            storage.to_path_buf(),
            stdout,
            "stdout",
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(capture_backend_output(
            storage.to_path_buf(),
            stderr,
            "stderr",
        ));
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
    let token = if let Some(webapp) = webapp {
        if webapp.port != port {
            return Err("Gateway 未在指定的本机端口启用 Webapp".into());
        }
        super::web_access::desktop_credential(&gateway_home, pid, port).await?
    } else {
        token
    };
    ping(port, &token).await?;
    verify_private_api(port, &token, webapp.is_some()).await?;
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

    Ok(SpawnedGateway {
        child,
        registration,
        port,
        token,
        endpoint,
    })
}
