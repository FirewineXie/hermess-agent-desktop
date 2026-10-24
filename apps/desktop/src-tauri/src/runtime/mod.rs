pub mod chat;
pub mod config;
pub mod models;
pub mod tools;

use crate::diagnostics::{append_client_event, capture_backend_output};
use crate::gateway::GatewayClient;
use crate::storage::product_storage;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
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
    storage: PathBuf,
    child: Child,
    port: u16,
    token: String,
    gateway: GatewayClient,
    bundled_tools_root: Option<PathBuf>,
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
    launch_backend(app, state, hermes, PathBuf::from(storage_path), false).await
}

fn expected_runtime_target() -> Result<&'static str, String> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Ok("win32-x64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok("darwin-x64")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok("darwin-arm64")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok("linux-x64")
    } else {
        Err("当前平台尚无经过验收的内置运行时".into())
    }
}

fn validate_payload(payload: &std::path::Path) -> Result<PathBuf, String> {
    let manifest = fs::read(payload.join("manifest.json"))
        .map_err(|_| "发行资源缺少 Hermes 清单".to_string())?;
    let value: Value =
        serde_json::from_slice(&manifest).map_err(|_| "Hermes 清单格式无效".to_string())?;
    let lock: Value =
        serde_json::from_str(include_str!("../../../../../runtime/upstream.lock.json"))
            .map_err(|_| "产品上游锁文件无效".to_string())?;
    let target = expected_runtime_target()?;
    let launcher = if cfg!(windows) {
        "bin/hermes.exe"
    } else {
        "bin/hermes"
    };
    if value.get("schema").and_then(Value::as_u64) != Some(1)
        || value.get("target").and_then(Value::as_str) != Some(target)
        || value.get("repo").and_then(Value::as_str) != Some("hermes-agent")
        || value.get("ref") != lock.get("commit")
        || value
            .pointer("/runtime/commands/hermes")
            .and_then(Value::as_str)
            != Some(launcher)
    {
        return Err("内置运行时与产品锁定版本不匹配".into());
    }
    let launcher = payload.join(launcher);
    let real = launcher
        .canonicalize()
        .map_err(|_| "内置 Hermes 启动器不存在".to_string())?;
    let root = payload
        .canonicalize()
        .map_err(|_| "内置运行时目录不存在".to_string())?;
    if !real.starts_with(root) {
        return Err("内置 Hermes 启动器越过资源目录".into());
    }
    Ok(real)
}

fn install_packed_payload(resource: &Path, selected: &Path) -> Result<PathBuf, String> {
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    fs::create_dir_all(selected).map_err(|_| "无法创建存储位置".to_string())?;
    let root = selected
        .canonicalize()
        .map_err(|_| "无法解析存储位置".to_string())?
        .join("HermessAgentDesktop");
    fs::create_dir_all(root.join("control")).map_err(|_| "无法创建产品控制目录".to_string())?;
    let root = root
        .canonicalize()
        .map_err(|_| "无法解析产品存储目录".to_string())?;
    let install_lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(root.join("control/runtime-install.lock"))
        .map_err(|_| "无法打开运行时安装锁".to_string())?;
    install_lock
        .try_lock()
        .map_err(|_| "运行时正在由另一个实例准备".to_string())?;

    let receipt: Value = serde_json::from_slice(
        &fs::read(resource.join("runtime/receipt.json"))
            .map_err(|_| "离线资源缺少校验清单".to_string())?,
    )
    .map_err(|_| "离线资源校验清单无效".to_string())?;
    let lock: Value =
        serde_json::from_str(include_str!("../../../../../runtime/upstream.lock.json"))
            .map_err(|_| "产品上游锁文件无效".to_string())?;
    let digest = receipt
        .get("archive_sha256")
        .and_then(Value::as_str)
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("离线资源摘要无效")?;
    if receipt.get("schema").and_then(Value::as_u64) != Some(1)
        || receipt.get("target").and_then(Value::as_str) != Some(expected_runtime_target()?)
        || receipt.get("upstream_commit") != lock.get("commit")
    {
        return Err("离线资源与产品锁定版本不匹配".into());
    }
    let archive_path = resource.join("runtime/payload.tar");
    let mut archive_file =
        fs::File::open(&archive_path).map_err(|_| "离线运行时归档不存在".to_string())?;
    if receipt.get("archive_bytes").and_then(Value::as_u64)
        != Some(
            archive_file
                .metadata()
                .map_err(|_| "无法读取运行时归档大小".to_string())?
                .len(),
        )
    {
        return Err("离线运行时归档大小不符".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let count = archive_file
            .read(&mut buffer)
            .map_err(|_| "读取运行时归档失败".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != digest {
        return Err("离线运行时归档摘要不符".into());
    }

    let runtimes = root.join("runtimes");
    fs::create_dir_all(&runtimes).map_err(|_| "无法创建运行时目录".to_string())?;
    let active = runtimes.join(digest);
    if active.exists() {
        return validate_payload(&active);
    }
    let staging = runtimes.join(format!("{digest}-staging-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|_| "无法创建运行时暂存目录".to_string())?;
    let installed = (|| -> Result<PathBuf, String> {
        let mut archive = tar::Archive::new(
            fs::File::open(&archive_path).map_err(|_| "无法重新打开运行时归档".to_string())?,
        );
        let mut count = 0usize;
        #[cfg(unix)]
        let mut links = Vec::<(PathBuf, PathBuf)>::new();
        for entry in archive
            .entries()
            .map_err(|_| "运行时归档目录损坏".to_string())?
        {
            let mut entry = entry.map_err(|_| "运行时归档条目损坏".to_string())?;
            count += 1;
            if count > 200_000 {
                return Err("运行时归档条目过多".into());
            }
            let path = entry.path().map_err(|_| "运行时归档路径无效".to_string())?;
            if path
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
            {
                return Err("运行时归档包含非法路径".into());
            }
            let kind = entry.header().entry_type();
            if kind.is_symlink() {
                #[cfg(unix)]
                {
                    let target = entry
                        .link_name()
                        .map_err(|_| "运行时链接目标无效".to_string())?
                        .ok_or("运行时链接缺少目标")?;
                    if target.is_absolute() || target.to_string_lossy().len() > 4096 {
                        return Err("运行时链接目标不安全".into());
                    }
                    let mut normalized = PathBuf::new();
                    for part in path
                        .parent()
                        .unwrap_or(Path::new(""))
                        .join(&target)
                        .components()
                    {
                        match part {
                            Component::Normal(name) => normalized.push(name),
                            Component::CurDir => {}
                            Component::ParentDir if normalized.pop() => {}
                            _ => return Err("运行时链接越过资源目录".into()),
                        }
                    }
                    if normalized.as_os_str().is_empty() {
                        return Err("运行时链接目标无效".into());
                    }
                    links.push((path.to_path_buf(), target.to_path_buf()));
                    continue;
                }
                #[cfg(not(unix))]
                return Err("当前平台不接受运行时链接".into());
            }
            if !kind.is_file() && !kind.is_dir() {
                return Err("运行时归档包含非普通文件".into());
            }
            entry
                .unpack_in(&staging)
                .map_err(|_| "解包运行时失败".to_string())?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            for (link, target) in &links {
                let destination = staging.join(&link);
                if destination.exists() || destination.symlink_metadata().is_ok() {
                    return Err("运行时归档包含重复链接路径".into());
                }
                symlink(target, &destination).map_err(|_| "创建运行时链接失败".to_string())?;
            }
            for (link, _) in links {
                let destination = staging.join(&link);
                let resolved = destination
                    .canonicalize()
                    .map_err(|_| "运行时链接悬空".to_string())?;
                if !resolved.starts_with(&staging) {
                    return Err("运行时链接越过资源目录".into());
                }
            }
        }
        validate_payload(&staging)?;
        fs::rename(&staging, &active).map_err(|_| "启用运行时失败".to_string())?;
        validate_payload(&active)
    })();
    if installed.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    installed
}

fn location_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("storage-location.json"))
        .map_err(|_| "无法定位产品配置目录".to_string())
}

fn saved_storage_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let file = location_file(app)?;
    read_storage_location(&file)
}

fn read_storage_location(file: &Path) -> Result<Option<PathBuf>, String> {
    if !file.exists() {
        return Ok(None);
    }
    let value: Value =
        serde_json::from_slice(&fs::read(file).map_err(|_| "读取存储定位文件失败".to_string())?)
            .map_err(|_| "存储定位文件损坏".to_string())?;
    if value.get("schema").and_then(Value::as_u64) != Some(1) {
        return Err("存储定位文件版本不兼容".into());
    }
    let path = value
        .get("storage_path")
        .and_then(Value::as_str)
        .ok_or("存储定位文件缺少路径")?;
    let selected = PathBuf::from(path);
    if !selected.is_absolute() {
        return Err("存储定位文件中的路径不是绝对路径".into());
    }
    Ok(Some(selected))
}

fn save_storage_path(app: &AppHandle, selected: &Path) -> Result<(), String> {
    let file = location_file(app)?;
    write_storage_location(&file, selected)
}

fn write_storage_location(file: &Path, selected: &Path) -> Result<(), String> {
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    let parent = file.parent().ok_or("存储定位文件路径无效")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建产品配置目录".to_string())?;
    let temporary = parent.join(format!("storage-location-{}.tmp", Uuid::new_v4()));
    let bytes =
        serde_json::to_vec(&json!({"schema": 1, "storage_path": selected.to_string_lossy()}))
            .map_err(|_| "无法编码存储定位文件".to_string())?;
    fs::write(&temporary, bytes).map_err(|_| "无法写入存储定位文件".to_string())?;
    if let Err(error) = fs::rename(&temporary, &file) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法启用存储定位文件：{error}"));
    }
    Ok(())
}

#[tauri::command]
pub fn packed_backend_defaults(app: AppHandle) -> Result<PackedDefaults, String> {
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
) -> Result<BackendInfo, String> {
    if cfg!(debug_assertions) {
        return Err("内置运行时入口仅供打包构建使用".into());
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|_| "无法定位应用资源目录".to_string())?;
    let selected = PathBuf::from(storage_path);
    if let Some(saved) = saved_storage_path(&app)? {
        if !saved.exists() {
            return Err("已选择的主要存储位置不可用；请恢复该位置".into());
        }
        if saved
            .canonicalize()
            .map_err(|_| "无法解析已选存储位置".to_string())?
            != selected
                .canonicalize()
                .map_err(|_| "主要存储位置与已保存位置不一致".to_string())?
        {
            return Err("初始化后不能直接切换主要存储位置".into());
        }
    }
    let resource_for_install = resource.clone();
    let selected_for_install = selected.clone();
    let hermes = tokio::task::spawn_blocking(move || {
        install_packed_payload(&resource_for_install, &selected_for_install)
    })
    .await
    .map_err(|_| "运行时准备任务失败".to_string())??;
    if saved_storage_path(&app)?.is_none() {
        let resolved = selected
            .canonicalize()
            .map_err(|_| "无法解析主要存储位置".to_string())?;
        save_storage_path(&app, &resolved)?;
    }
    launch_backend(app, state, hermes, selected, true).await
}

async fn launch_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
    hermes: PathBuf,
    selected: PathBuf,
    disable_lazy_installs: bool,
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
    let _ = append_client_event(&storage, "backend_starting");
    let run = storage.join("control").join(Uuid::new_v4().to_string());
    fs::create_dir_all(&run).map_err(|_| "无法创建私有控制目录".to_string())?;
    let ready = run.join("ready.json");
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let bundled_tools_root = hermes.parent().and_then(Path::parent).and_then(|root| {
        root.join("manifest.json")
            .is_file()
            .then(|| root.join("tools"))
    });
    let mut command = tokio::process::Command::new(hermes);
    command
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if disable_lazy_installs {
        command.env("HERMES_DISABLE_LAZY_INSTALLS", "1");
    }
    let mut child = command.spawn().map_err(|_| "后端启动失败".to_string())?;
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(capture_backend_output(storage.clone(), stdout, "stdout"));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(capture_backend_output(storage.clone(), stderr, "stderr"));
    }
    let pid = child.id().ok_or("无法获取后端 PID")?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let port = loop {
        if child
            .try_wait()
            .map_err(|_| "后端进程状态读取失败".to_string())?
            .is_some()
        {
            return Err("后端在发布就绪状态前退出；请查看开发者诊断中的 Hermess 日志".into());
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
    let _ = append_client_event(&storage, "backend_ready");
    *owned = Some(OwnedBackend {
        _storage_lock: storage_lock,
        storage,
        child,
        port,
        token,
        gateway,
        bundled_tools_root,
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
        let _ = append_client_event(&backend.storage, "backend_stopping");
        backend.gateway.close();
        backend
            .child
            .start_kill()
            .map_err(|_| "停止本产品后端失败".to_string())?;
        timeout(Duration::from_secs(8), backend.child.wait())
            .await
            .map_err(|_| "等待后端退出超时".to_string())?
            .map_err(|_| "后端退出状态读取失败".to_string())?;
        let _ = append_client_event(&backend.storage, "backend_stopped");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::models::{load_model_lists, parse_saved_model_config, save_model_lists};
    use super::BackendInfo;
    use super::{
        acquire_storage_lock, install_packed_payload, read_storage_location, validate_payload,
        write_storage_location,
    };
    use crate::diagnostics::{
        append_client_event, daily_log_files, newest_log_entries_first, read_diagnostic_logs,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::process::Command;
    use uuid::Uuid;

    #[test]
    fn backend_info_matches_shared_contract_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/contracts/fixtures/backend-info.json"
        )))
        .unwrap();
        let actual = serde_json::to_value(BackendInfo {
            port: 1421,
            pid: 421,
            replay_epoch: "fixture-epoch".to_owned(),
        })
        .unwrap();
        assert_eq!(actual, fixture);
    }

    #[test]
    fn model_lists_survive_a_second_read() {
        let root = std::env::temp_dir().join(format!("hermess-model-lists-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("HermessAgentDesktop")).unwrap();
        let storage = root.to_string_lossy().into_owned();
        assert!(load_model_lists(storage.clone()).unwrap().is_none());
        let lists = HashMap::from([(
            "ark-provider".to_string(),
            vec!["ark-code-latest".to_string()],
        )]);
        save_model_lists(storage.clone(), lists.clone()).unwrap();
        assert_eq!(load_model_lists(storage).unwrap(), Some(lists));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn diagnostic_entries_show_newest_first_without_reversing_stack_traces() {
        let content = "2026-10-24 23:22:15 INFO first\n  first detail\n2026-10-24 23:22:16 ERROR second\n  second detail";
        assert_eq!(
            newest_log_entries_first(content),
            "2026-10-24 23:22:16 ERROR second\n  second detail\n2026-10-24 23:22:15 INFO first\n  first detail"
        );
    }

    #[test]
    fn saved_model_config_returns_only_public_model_fields() {
        let yaml = "model:\n  provider: custom\n  default: ark-code-latest\n  base_url: https://ark.cn-beijing.volces.com/api/coding/v3\n  api_key: secret-example\n";
        let config = parse_saved_model_config(yaml).unwrap();
        assert_eq!(config.provider, "custom");
        assert_eq!(config.model, "ark-code-latest");
        assert_eq!(
            config.base_url,
            "https://ark.cn-beijing.volces.com/api/coding/v3"
        );
        assert!(!serde_json::to_string(&config)
            .unwrap()
            .contains("secret-example"));
    }

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
            .args(["--exact", "runtime::tests::storage_lock_child"])
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

    #[cfg(all(windows, target_arch = "x86_64"))]
    #[test]
    fn packed_payload_rejects_a_different_upstream_commit() {
        let root = std::env::temp_dir().join(format!("hermess-payload-check-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin/hermes.exe"), b"test launcher").unwrap();
        let lock: serde_json::Value =
            serde_json::from_str(include_str!("../../../../../runtime/upstream.lock.json"))
                .unwrap();
        let mut manifest = serde_json::json!({
            "schema": 1, "target": "win32-x64", "repo": "hermes-agent",
            "ref": lock["commit"], "runtime": {"commands": {"hermes": "bin/hermes.exe"}}
        });
        fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
        assert!(validate_payload(&root).is_ok());
        manifest["ref"] = serde_json::json!("different-upstream-commit");
        fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
        assert!(validate_payload(&root).is_err());
        fs::remove_file(root.join("manifest.json")).unwrap();
        fs::remove_file(root.join("bin/hermes.exe")).unwrap();
        fs::remove_dir(root.join("bin")).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(all(windows, target_arch = "x86_64"))]
    #[test]
    #[ignore = "requires a prepared 1.6 GB offline runtime archive under .build/runtime"]
    fn packed_payload_installs_from_real_archive() {
        let product = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let build = product.join(".build");
        let selected = build.join("installed-runtime-smoke");
        let launcher = install_packed_payload(&build, &selected).unwrap();
        assert!(launcher.is_file());
        assert_eq!(install_packed_payload(&build, &selected).unwrap(), launcher);
    }

    #[test]
    fn storage_location_survives_restart_and_refuses_corruption() {
        let root = std::env::temp_dir().join(format!("hermess-location-{}", Uuid::new_v4()));
        let file = root.join("config/location.json");
        assert!(read_storage_location(&file).unwrap().is_none());
        let selected = root.join("中文 空格 存储");
        write_storage_location(&file, &selected).unwrap();
        assert_eq!(read_storage_location(&file).unwrap(), Some(selected));
        fs::write(&file, b"{broken").unwrap();
        assert!(read_storage_location(&file).is_err());
        fs::remove_file(file).unwrap();
        fs::remove_dir(root.join("config")).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn client_events_use_daily_files_and_diagnostics_keep_sources_separate() {
        let selected = std::env::temp_dir().join(format!("hermess-logs-{}", Uuid::new_v4()));
        let storage = selected.join("HermessAgentDesktop");
        fs::create_dir_all(&storage).unwrap();
        append_client_event(&storage, "backend_starting").unwrap();
        append_client_event(&storage, "backend_started").unwrap();
        let files = daily_log_files(&storage, "client-").unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("client-"));
        let client_logs =
            read_diagnostic_logs(selected.to_string_lossy().into_owned(), "client".into()).unwrap();
        assert!(
            client_logs.find("backend_started").unwrap()
                < client_logs.find("backend_starting").unwrap()
        );
        assert!(
            !read_diagnostic_logs(selected.to_string_lossy().into_owned(), "hermes".into())
                .unwrap()
                .contains("backend_starting")
        );
        fs::remove_dir_all(selected).unwrap();
    }
}
