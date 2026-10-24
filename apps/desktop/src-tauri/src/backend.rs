use crate::gateway::GatewayClient;
use chrono::Local;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
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

fn product_storage(selected: &Path) -> Result<PathBuf, String> {
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    let selected = selected
        .canonicalize()
        .map_err(|_| "无法解析存储位置".to_string())?;
    let storage = selected.join("HermessAgentDesktop");
    storage
        .canonicalize()
        .map_err(|_| "产品存储目录尚未创建".to_string())
}

#[tauri::command]
pub fn load_model_lists(
    storage_path: String,
) -> Result<Option<HashMap<String, Vec<String>>>, String> {
    let file = product_storage(Path::new(&storage_path))?.join("model-candidates.json");
    if !file.exists() {
        return Ok(None);
    }
    let bytes = fs::read(file).map_err(|_| "无法读取本机模型候选".to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("本机模型候选文件过大".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "本机模型候选文件格式无效".to_string())
}

#[tauri::command]
pub fn save_model_lists(
    storage_path: String,
    lists: HashMap<String, Vec<String>>,
) -> Result<(), String> {
    if lists.len() > 256
        || lists.iter().any(|(provider, models)| {
            provider.is_empty()
                || provider.len() > 256
                || models.len() > 2048
                || models.iter().any(|model| {
                    model.trim().is_empty()
                        || model.len() > 256
                        || model.chars().any(char::is_whitespace)
                })
        })
    {
        return Err("本机模型候选无效".into());
    }
    let bytes = serde_json::to_vec(&lists).map_err(|_| "无法编码本机模型候选".to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("本机模型候选文件过大".into());
    }
    let file = product_storage(Path::new(&storage_path))?.join("model-candidates.json");
    fs::write(file, bytes).map_err(|_| "无法保存本机模型候选".to_string())
}

fn append_client_event(storage: &Path, event: &str) -> Result<(), String> {
    let now = Local::now();
    let logs = storage.join("logs");
    fs::create_dir_all(&logs).map_err(|_| "无法创建日志目录".to_string())?;
    let path = logs.join(format!("client-{}.log", now.format("%Y-%m-%d")));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|_| "无法写入客户端日志".to_string())?;
    writeln!(file, "{} {event}", now.format("%Y-%m-%d %H:%M:%S%.3f"))
        .map_err(|_| "无法写入客户端日志".to_string())
}

async fn capture_backend_output<R: tokio::io::AsyncRead + Unpin>(
    storage: PathBuf,
    stream: R,
    name: &'static str,
) {
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let now = Local::now();
                let logs = storage.join("logs");
                if fs::create_dir_all(&logs).is_err() {
                    break;
                }
                let path = logs.join(format!("hermes-backend-{}.log", now.format("%Y-%m-%d")));
                if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
                    let _ = writeln!(
                        file,
                        "{} [{name}] {}",
                        now.format("%Y-%m-%d %H:%M:%S%.3f"),
                        String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n'])
                    );
                }
            }
        }
    }
}

fn daily_log_files(storage: &Path, prefix: &str) -> Result<Vec<PathBuf>, String> {
    let logs = storage.join("logs");
    if !logs.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(logs)
        .map_err(|_| "无法读取日志目录".to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_name().to_string_lossy().starts_with(prefix)
                && entry.file_name().to_string_lossy().ends_with(".log")
                && entry.path().is_file()
        })
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    files.sort();
    files.reverse();
    files.truncate(3);
    Ok(files)
}

fn newest_log_entries_first(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let starts_entry = |line: &str| {
        let bytes = line.as_bytes();
        bytes.len() >= 19
            && [4, 7].iter().all(|&i| bytes[i] == b'-')
            && bytes[10] == b' '
            && [13, 16].iter().all(|&i| bytes[i] == b':')
            && [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
                .iter()
                .all(|&i| bytes[i].is_ascii_digit())
    };
    if !lines.iter().any(|line| starts_entry(line)) {
        return lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    }
    let mut entries: Vec<Vec<&str>> = Vec::new();
    for line in lines {
        if starts_entry(line) || entries.is_empty() {
            entries.push(vec![line]);
        } else {
            entries.last_mut().unwrap().push(line);
        }
    }
    entries
        .into_iter()
        .rev()
        .map(|entry| entry.join("\n"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_log_tail(path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Ok(String::new());
    }
    let mut file = fs::File::open(path).map_err(|_| "无法打开日志文件".to_string())?;
    let size = file
        .metadata()
        .map_err(|_| "无法读取日志大小".to_string())?
        .len();
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(size.saturating_sub(128 * 1024)))
        .map_err(|_| "无法定位日志末尾".to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| "无法读取日志".to_string())?;
    let content = String::from_utf8_lossy(&bytes);
    let content = if size > 128 * 1024 {
        content.lines().skip(1).collect::<Vec<_>>().join("\n")
    } else {
        content.into_owned()
    };
    Ok(newest_log_entries_first(&content))
}

fn log_section(path: &Path, name: &str) -> Result<Option<(SystemTime, String)>, String> {
    let content = read_log_tail(path)?;
    if content.is_empty() {
        return Ok(None);
    }
    let modified = path
        .metadata()
        .and_then(|metadata| metadata.modified())
        .map_err(|_| "无法读取日志修改时间".to_string())?;
    Ok(Some((modified, format!("=== {name} ===\n{content}"))))
}

#[tauri::command]
pub fn read_diagnostic_logs(storage_path: String, source: String) -> Result<String, String> {
    let storage = product_storage(Path::new(&storage_path))?;
    let (daily_prefix, legacy_files): (&str, &[(&str, &str)]) = match source.as_str() {
        "hermes" => (
            "hermes-backend-",
            &[
                ("gateway.log", "hermes-home/logs/gateway.log"),
                ("agent.log", "hermes-home/logs/agent.log"),
                ("errors.log", "hermes-home/logs/errors.log"),
            ],
        ),
        "client" => ("client-", &[("desktop.log (旧版)", "control/desktop.log")]),
        _ => return Err("未知日志来源".into()),
    };
    let mut sections = Vec::new();
    for &(name, relative) in legacy_files {
        if let Some(section) = log_section(&storage.join(relative), name)? {
            sections.push(section);
        }
    }
    if source == "hermes" {
        let control = storage.join("control");
        if control.is_dir() {
            let latest = fs::read_dir(control)
                .map_err(|_| "无法读取控制目录".to_string())?
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let path = entry.path().join("backend.log");
                    let modified = path.metadata().ok()?.modified().ok()?;
                    Some((modified, path))
                })
                .max_by_key(|(modified, _)| *modified);
            if let Some((_, path)) = latest {
                if let Some(section) = log_section(&path, "backend.log (旧版)")? {
                    sections.push(section);
                }
            }
        }
    }
    for path in daily_log_files(&storage, daily_prefix)? {
        if let Some(section) = log_section(
            &path,
            &path.file_name().unwrap_or_default().to_string_lossy(),
        )? {
            sections.push(section);
        }
    }
    sections.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(sections
        .into_iter()
        .map(|(_, content)| content)
        .collect::<Vec<_>>()
        .join("\n\n"))
}

#[tauri::command]
pub fn record_client_event(storage_path: String, event: String) -> Result<(), String> {
    if !matches!(
        event.as_str(),
        "startup_failed" | "connection_failed" | "reconnect_failed" | "stop_failed"
    ) {
        return Err("未知诊断事件".into());
    }
    append_client_event(&product_storage(Path::new(&storage_path))?, &event)
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
    let lock: Value = serde_json::from_str(include_str!("../../../../runtime/upstream.lock.json"))
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
    let lock: Value = serde_json::from_str(include_str!("../../../../runtime/upstream.lock.json"))
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
pub async fn list_bundled_tools(
    state: State<'_, BackendState>,
) -> Result<BundledToolsInventory, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let Some(root) = &backend.bundled_tools_root else {
        return Ok(BundledToolsInventory {
            has_manifest: false,
            tools: Vec::new(),
        });
    };
    let facts_path = root.join("facts.json");
    let metadata = fs::metadata(&facts_path).map_err(|_| "运行时工具清单缺失".to_string())?;
    if metadata.len() > 1024 * 1024 {
        return Err("运行时工具清单过大".into());
    }
    let facts: Value = serde_json::from_slice(
        &fs::read(&facts_path).map_err(|_| "无法读取运行时工具清单".to_string())?,
    )
    .map_err(|_| "运行时工具清单格式无效".to_string())?;
    let packages = facts
        .get("packages")
        .and_then(Value::as_object)
        .ok_or("运行时工具清单缺少包列表")?;
    let mut tools = Vec::new();
    for (name, package) in packages.iter().take(256) {
        let Some(entry) = package.get("entry").and_then(Value::as_str) else {
            continue;
        };
        let mut components = Path::new(entry).components();
        if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
            continue;
        }
        let path = root.join(entry);
        tools.push(BundledTool {
            name: name.clone(),
            version: package
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            path: path.to_string_lossy().into_owned(),
            present: path.is_dir(),
        });
    }
    Ok(BundledToolsInventory {
        has_manifest: true,
        tools,
    })
}

#[tauri::command]
pub async fn list_agent_toolsets(
    state: State<'_, BackendState>,
    session_id: Option<String>,
) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("tools.list", json!({"session_id": session_id}))
        .await
}

#[tauri::command]
pub async fn list_active_agent_tools(
    state: State<'_, BackendState>,
    session_id: Option<String>,
) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("tools.show", json!({"session_id": session_id}))
        .await
}

#[tauri::command]
pub async fn list_model_options(
    state: State<'_, BackendState>,
    refresh: bool,
    include_unconfigured: Option<bool>,
    session_id: Option<String>,
) -> Result<Value, String> {
    if session_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 256)
    {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let mut params = json!({"include_unconfigured": include_unconfigured.unwrap_or(true),
                            "refresh": refresh});
    if let Some(id) = session_id {
        params["session_id"] = json!(id);
    }
    backend.gateway.request("model.options", params).await
}

#[tauri::command]
pub async fn select_chat_model(
    state: State<'_, BackendState>,
    session_id: String,
    provider: String,
    model: String,
    confirm: Option<String>,
) -> Result<Value, String> {
    let provider = provider.trim();
    let model = model.trim();
    if session_id.is_empty()
        || session_id.len() > 256
        || provider.is_empty()
        || provider.len() > 128
        || provider.chars().any(char::is_whitespace)
        || model.is_empty()
        || model.len() > 256
        || model.chars().any(char::is_whitespace)
    {
        return Err("会话模型选择无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let snapshot = backend
        .gateway
        .request("session.resume", json!({"session_id": session_id}))
        .await?;
    let revision = snapshot
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or("会话缺少修订版本")?;
    let generation = snapshot
        .get("execution_generation")
        .and_then(Value::as_u64)
        .ok_or("会话缺少运行代次")?;
    let mut payload = json!({"provider": provider, "model": model});
    if let Some(token) = confirm.filter(|value| !value.is_empty() && value.len() <= 256) {
        payload["confirm"] = json!(token);
    }
    backend
        .gateway
        .request(
            "session.mutate",
            json!({
                "session_id": session_id,
                "request_id": Uuid::new_v4().to_string(),
                "expected_revision": revision,
                "expected_generation": generation,
                "operation": "model",
                "payload": payload,
            }),
        )
        .await
}

#[derive(Debug, PartialEq, Serialize)]
pub struct SavedModelConfig {
    provider: String,
    model: String,
    base_url: String,
}

fn parse_saved_model_config(yaml: &str) -> Result<SavedModelConfig, String> {
    let config: serde_yaml::Value =
        serde_yaml::from_str(yaml).map_err(|_| "模型配置格式无法解析".to_string())?;
    let model = config.get("model");
    let field = |name| {
        model
            .and_then(|value| value.get(name))
            .and_then(serde_yaml::Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    Ok(SavedModelConfig {
        provider: field("provider"),
        model: model
            .and_then(serde_yaml::Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| {
                let default = field("default");
                if default.is_empty() {
                    field("name")
                } else {
                    default
                }
            }),
        base_url: field("base_url"),
    })
}

#[tauri::command]
pub async fn get_saved_model_config(
    state: State<'_, BackendState>,
) -> Result<SavedModelConfig, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut response = client
        .get(format!("http://127.0.0.1:{}/api/config/raw", backend.port))
        .header("X-Hermes-Session-Token", &backend.token)
        .send()
        .await
        .map_err(|_| "读取本地模型配置失败".to_string())?;
    if !response.status().is_success() {
        return Err("后端拒绝读取模型配置".into());
    }
    const MAX_CONFIG_BYTES: usize = 256 * 1024;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_CONFIG_BYTES as u64)
    {
        return Err("模型配置响应过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取模型配置响应失败".to_string())?
    {
        if bytes.len() + chunk.len() > MAX_CONFIG_BYTES {
            return Err("模型配置响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "模型配置响应无效".to_string())?;
    let yaml = value
        .get("yaml")
        .and_then(Value::as_str)
        .ok_or("模型配置响应缺少内容")?;
    parse_saved_model_config(yaml)
}

async fn config_request(
    state: &State<'_, BackendState>,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut request = client
        .request(method, format!("http://127.0.0.1:{}{path}", backend.port))
        .header("X-Hermes-Session-Token", &backend.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "配置请求失败".to_string())?;
    const LIMIT: usize = 2 * 1024 * 1024;
    if response
        .content_length()
        .is_some_and(|size| size > LIMIT as u64)
    {
        return Err("配置响应过大".into());
    }
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取配置响应失败".to_string())?
    {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("配置响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "配置响应不是有效 JSON".to_string())?;
    if !status.is_success() {
        // 上游错误可能包含用户配置或凭据，不向界面透传正文。
        return Err(format!("后端配置请求失败（HTTP {status}）"));
    }
    Ok(value)
}

#[tauri::command]
pub async fn get_agent_config(state: State<'_, BackendState>) -> Result<Value, String> {
    config_request(&state, reqwest::Method::GET, "/api/config", None).await
}

#[tauri::command]
pub async fn get_agent_config_schema(state: State<'_, BackendState>) -> Result<Value, String> {
    config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await
}

#[tauri::command]
pub async fn get_agent_config_raw(state: State<'_, BackendState>) -> Result<Value, String> {
    config_request(&state, reqwest::Method::GET, "/api/config/raw", None).await
}

#[tauri::command]
pub async fn save_auxiliary_route(
    state: State<'_, BackendState>,
    task: String,
    provider: String,
    model: String,
    effort: String,
    timeout: Option<f64>,
) -> Result<Value, String> {
    if task.is_empty()
        || task.len() > 80
        || !task.bytes().all(|c| c.is_ascii_lowercase() || c == b'_')
        || provider.len() > 128
        || model.len() > 256
        || ![
            "", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
        ]
        .contains(&effort.as_str())
        || timeout.is_some_and(|value| !value.is_finite() || value <= 0.0)
    {
        return Err("辅助模型配置无效".into());
    }
    let schema = config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await?;
    if schema
        .pointer(&format!("/fields/auxiliary.{task}.provider"))
        .is_none()
    {
        return Err("辅助模型任务不在当前运行时配置中".into());
    }
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || (provider != "auto" && model.is_empty()) {
        return Err("请选择提供商和模型".into());
    }
    // A single config PUT prevents an old per-task endpoint or credential from
    // silently overriding the selected named provider.
    let mut auxiliary = serde_json::Map::new();
    let mut route = json!({
        "provider": provider, "model": model,
        "base_url": null, "api_key": null, "key_env": null,
        "api_key_env": null, "api_mode": null
    });
    if schema
        .pointer(&format!("/fields/auxiliary.{task}.reasoning_effort"))
        .is_some()
    {
        route["reasoning_effort"] = json!(effort);
    }
    if let Some(value) = timeout {
        if schema
            .pointer(&format!("/fields/auxiliary.{task}.timeout"))
            .is_some()
        {
            route["timeout"] = json!(value);
        }
    }
    auxiliary.insert(task, route);
    config_request(
        &state,
        reqwest::Method::PUT,
        "/api/config",
        Some(json!({"config": {"auxiliary": auxiliary}})),
    )
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
pub async fn list_custom_endpoints(state: State<'_, BackendState>) -> Result<Value, String> {
    config_request(
        &state,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await
}

#[tauri::command]
pub async fn add_custom_endpoint(
    state: State<'_, BackendState>,
    name: String,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<Value, String> {
    let name = name.trim();
    let base_url = base_url.trim();
    let model = model.trim();
    if name.is_empty()
        || name.len() > 128
        || model.is_empty()
        || model.len() > 256
        || model.chars().any(char::is_whitespace)
        || api_key.len() > 4096
    {
        return Err("提供商名称、模型 ID 或密钥无效".into());
    }
    let parsed = reqwest::Url::parse(base_url).map_err(|_| "模型接口地址无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err("模型接口必须是无内嵌凭据的 HTTP 或 HTTPS 地址".into());
    }
    let mut body = json!({"id": format!("desktop-{}", Uuid::new_v4().simple()),
        "name": name, "base_url": base_url, "model": model, "make_default": false});
    if !api_key.is_empty() {
        body["api_key"] = json!(api_key);
    }
    config_request(
        &state,
        reqwest::Method::POST,
        "/api/providers/custom-endpoints",
        Some(body),
    )
    .await
}

#[tauri::command]
pub async fn delete_custom_endpoint(
    state: State<'_, BackendState>,
    endpoint_id: String,
) -> Result<Value, String> {
    if endpoint_id.is_empty()
        || endpoint_id.len() > 128
        || endpoint_id.chars().any(char::is_control)
    {
        return Err("提供商标识无效".into());
    }
    let listed = config_request(
        &state,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await?;
    let removable = listed
        .get("endpoints")
        .and_then(Value::as_array)
        .is_some_and(|endpoints| {
            endpoints.iter().any(|endpoint| {
                endpoint.get("id").and_then(Value::as_str) == Some(endpoint_id.as_str())
                    && endpoint.get("source").and_then(Value::as_str) != Some("direct-config")
            })
        });
    if !removable {
        return Err("只能删除已保存的自定义提供商".into());
    }
    let mut url = reqwest::Url::parse("http://localhost/api/providers/custom-endpoints/")
        .map_err(|_| "无法构建提供商地址".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "无法构建提供商地址".to_string())?
        .push(&endpoint_id);
    config_request(&state, reqwest::Method::DELETE, url.path(), None).await
}

#[tauri::command]
pub async fn save_agent_config_field(
    state: State<'_, BackendState>,
    key: String,
    value: Value,
) -> Result<Value, String> {
    if key.is_empty()
        || key.len() > 256
        || !key.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
    {
        return Err("配置字段无效".into());
    }
    let schema = config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await?;
    if schema
        .pointer(&format!(
            "/fields/{}",
            key.replace('~', "~0").replace('/', "~1")
        ))
        .is_none()
    {
        return Err("配置字段不在当前上游 schema 中".into());
    }
    let mut patch = value;
    for part in key.split('.').rev() {
        let mut object = serde_json::Map::new();
        object.insert(part.to_owned(), patch);
        patch = Value::Object(object);
    }
    config_request(
        &state,
        reqwest::Method::PUT,
        "/api/config",
        Some(json!({"config": patch})),
    )
    .await
}

#[tauri::command]
pub async fn save_agent_config_raw(
    state: State<'_, BackendState>,
    yaml_text: String,
    expected_yaml: String,
) -> Result<Value, String> {
    if yaml_text.len() > 256 * 1024 || expected_yaml.len() > 256 * 1024 {
        return Err("配置内容过大".into());
    }
    let current = config_request(&state, reqwest::Method::GET, "/api/config/raw", None).await?;
    if current.get("yaml").and_then(Value::as_str) != Some(expected_yaml.as_str()) {
        return Err("配置文件已被其他操作修改，请重新读取后再保存".into());
    }
    config_request(
        &state,
        reqwest::Method::PUT,
        "/api/config/raw",
        Some(json!({"yaml_text": yaml_text})),
    )
    .await
}

#[tauri::command]
pub async fn check_model_runtime(state: State<'_, BackendState>) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("setup.runtime_check", json!({}))
        .await
}

#[tauri::command]
pub async fn set_default_model(
    state: State<'_, BackendState>,
    provider: String,
    model: String,
    base_url: String,
    api_key: String,
    confirm_expensive_model: bool,
) -> Result<Value, String> {
    let provider = provider.trim();
    let model = model.trim();
    let base_url = base_url.trim();
    if provider.is_empty()
        || provider.len() > 128
        || model.is_empty()
        || model.len() > 256
        || base_url.len() > 2048
        || api_key.len() > 4096
    {
        return Err("模型配置字段为空或过长".into());
    }
    if !base_url.is_empty() {
        let parsed = reqwest::Url::parse(base_url).map_err(|_| "模型接口地址无效".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
        {
            return Err("模型接口必须是无内嵌凭据的 HTTP 或 HTTPS 地址".into());
        }
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut response = client
        .post(format!("http://127.0.0.1:{}/api/model/set", backend.port))
        .header("X-Hermes-Session-Token", &backend.token)
        .json(&json!({
            "scope": "main", "provider": provider, "model": model,
            "base_url": base_url, "api_key": api_key,
            "confirm_expensive_model": confirm_expensive_model,
        }))
        .send()
        .await
        .map_err(|_| "本地模型配置请求失败".to_string())?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|size| size > 64 * 1024)
    {
        return Err("模型配置响应过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取模型配置响应失败".to_string())?
    {
        if bytes.len() + chunk.len() > 64 * 1024 {
            return Err("模型配置响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("模型配置返回无效 JSON（HTTP {status}）"))?;
    if !status.is_success() {
        let detail = value
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or("模型配置失败");
        let safe = if api_key.is_empty() {
            detail.to_owned()
        } else {
            detail.replace(&api_key, "[已隐藏]")
        };
        return Err(format!(
            "模型配置失败（HTTP {status}）：{}",
            safe.chars().take(400).collect::<String>()
        ));
    }
    Ok(value)
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
    use super::{
        acquire_storage_lock, append_client_event, daily_log_files, install_packed_payload,
        load_model_lists, newest_log_entries_first, parse_saved_model_config, read_diagnostic_logs,
        read_storage_location, save_model_lists, validate_payload, write_storage_location,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::process::Command;
    use uuid::Uuid;

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

    #[cfg(all(windows, target_arch = "x86_64"))]
    #[test]
    fn packed_payload_rejects_a_different_upstream_commit() {
        let root = std::env::temp_dir().join(format!("hermess-payload-check-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin/hermes.exe"), b"test launcher").unwrap();
        let lock: serde_json::Value =
            serde_json::from_str(include_str!("../../../../runtime/upstream.lock.json")).unwrap();
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
