use crate::errors::DesktopFailure;
use crate::process_manager;
use serde::Serialize;
use std::{env, path::PathBuf, time::Duration};
use tokio::{process::Command, time::timeout};

pub async fn apply_frontend_debug(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<(), DesktopFailure> {
    #[cfg(windows)]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                let result = unsafe {
                    webview
                        .controller()
                        .CoreWebView2()
                        .and_then(|core| core.Settings())
                        .and_then(|settings| settings.SetAreDevToolsEnabled(enabled))
                };
                let _ = sender.send(result.is_ok());
            })
            .map_err(|_| DesktopFailure::operation_failed())?;
        if receiver.await != Ok(true) {
            return Err(DesktopFailure::operation_failed());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, enabled);
        Err(DesktopFailure::operation_failed())
    }
}

#[derive(Serialize)]
pub struct RuntimeProbe {
    tool: &'static str,
    kind: &'static str,
    path: Option<String>,
    version: Option<String>,
    usable: bool,
    reason: String,
}

fn candidates(names: &[&str]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut directories = Vec::new();
    if let Some(paths) = env::var_os("PATH") {
        directories.extend(env::split_paths(&paths));
    }
    // uv 的已安装解释器通常不在 PATH；这里只读取既有安装，不触发下载。
    if let Some(app_data) = env::var_os("APPDATA") {
        let uv_python = PathBuf::from(app_data).join("uv").join("python");
        if let Ok(entries) = std::fs::read_dir(uv_python) {
            for entry in entries.flatten() {
                if entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("cpython-3.14.")
                {
                    directories.push(entry.path());
                }
            }
        }
    }
    for directory in directories {
        for name in names {
            let candidate = directory.join(name);
            if candidate.is_file() {
                if let Ok(real) = candidate.canonicalize() {
                    if !found.contains(&real) {
                        found.push(real);
                    }
                }
            }
        }
    }
    found
}

async fn inspect(tool: &'static str, names: &[&str], script: &str, prefix: &str) -> RuntimeProbe {
    let found = candidates(names);
    let mut last_reason = String::from("没有找到可执行文件");
    for path in found {
        let mut command = Command::new(&path);
        if tool == "Python" {
            command.args(["-c", script]);
        } else {
            command.args(["-e", script]);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        command.kill_on_drop(true);
        match timeout(
            Duration::from_secs(4),
            process_manager::output(&mut command, "runtime_probe"),
        )
        .await
        {
            Ok(Ok(output)) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                let expected_arch = match (tool, std::env::consts::ARCH) {
                    ("Node", "x86_64") => "x64",
                    ("Node", "aarch64") => "arm64",
                    ("Python", "x86_64") if cfg!(windows) => "AMD64",
                    ("Python", "x86_64") => "x86_64",
                    ("Python", "aarch64") if cfg!(target_os = "macos") => "arm64",
                    ("Python", "aarch64") => "aarch64",
                    _ => "unsupported-architecture",
                };
                let correct_arch = version.split_whitespace().last() == Some(expected_arch);
                let correct_impl = tool != "Python" || version.contains(" CPython ");
                if version.starts_with(prefix) && correct_arch && correct_impl {
                    return RuntimeProbe {
                        tool,
                        kind: "runtime",
                        path: Some(path.to_string_lossy().into_owned()),
                        version: Some(version),
                        usable: true,
                        reason: String::new(),
                    };
                }
                last_reason = format!("版本或架构未进入当前候选范围：{version}");
            }
            Ok(Ok(_)) => last_reason = String::from("执行失败或商店别名不可用"),
            Ok(Err(error)) => last_reason = format!("启动失败：{error}"),
            Err(_) => last_reason = String::from("检测超时"),
        }
    }
    RuntimeProbe {
        tool,
        kind: "runtime",
        path: None,
        version: None,
        usable: false,
        reason: last_reason,
    }
}

// 命令行工具共用此探测流程；增加内置工具时只需提供文件名、版本参数和输出前缀。
async fn inspect_version_command(
    tool: &'static str,
    names: &[&str],
    version_args: &[&str],
    version_prefix: &str,
) -> RuntimeProbe {
    let mut last_reason = String::from("没有找到可执行文件");
    for path in candidates(names) {
        let mut command = Command::new(&path);
        command.args(version_args).kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        match timeout(
            Duration::from_secs(4),
            process_manager::output(&mut command, "tool_probe"),
        )
        .await
        {
            Ok(Ok(output)) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_owned();
                let recognized = if version_prefix.is_empty() {
                    is_numeric_version(&version)
                } else {
                    version
                        .strip_prefix(version_prefix)
                        .is_some_and(|remainder| !remainder.trim().is_empty())
                };
                if recognized {
                    return RuntimeProbe {
                        tool,
                        kind: "command",
                        path: Some(path.to_string_lossy().into_owned()),
                        version: Some(version),
                        usable: true,
                        reason: String::new(),
                    };
                }
                last_reason = format!("版本输出无法识别：{version}");
            }
            Ok(Ok(_)) => last_reason = String::from("执行失败"),
            Ok(Err(error)) => last_reason = format!("启动失败：{error}"),
            Err(_) => last_reason = String::from("检测超时"),
        }
    }
    RuntimeProbe {
        tool,
        kind: "command",
        path: None,
        version: None,
        usable: false,
        reason: last_reason,
    }
}

fn is_numeric_version(version: &str) -> bool {
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[tauri::command]
pub async fn probe_local_tools() -> Vec<RuntimeProbe> {
    let python_names: &[&str] = if cfg!(windows) {
        &["python3.14.exe", "python.exe", "python3.exe"]
    } else {
        &["python3.14", "python3", "python"]
    };
    let node_names: &[&str] = if cfg!(windows) {
        &["node.exe"]
    } else {
        &["node"]
    };
    let npm_names: &[&str] = if cfg!(windows) {
        &["npm.cmd", "npm.exe"]
    } else {
        &["npm"]
    };
    let git_names: &[&str] = if cfg!(windows) {
        &["git.exe"]
    } else {
        &["git"]
    };
    let python = inspect(
        "Python", python_names,
        "import platform,sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} {platform.python_implementation()} {platform.machine()}')",
        "3.14.",
    ).await;
    let node = inspect(
        "Node",
        node_names,
        "console.log(process.versions.node + ' ' + process.arch)",
        "22.",
    )
    .await;
    let npm = inspect_version_command("npm", npm_names, &["--version"], "").await;
    let git = inspect_version_command("Git", git_names, &["--version"], "git version ").await;
    let ffmpeg_name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let ffprobe_name = if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    };
    let ripgrep_name = if cfg!(windows) { "rg.exe" } else { "rg" };
    let uv_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let gh_name = if cfg!(windows) { "gh.exe" } else { "gh" };
    let ffmpeg =
        inspect_version_command("FFmpeg", &[ffmpeg_name], &["-version"], "ffmpeg version ").await;
    let ffprobe = inspect_version_command(
        "FFprobe",
        &[ffprobe_name],
        &["-version"],
        "ffprobe version ",
    )
    .await;
    let ripgrep =
        inspect_version_command("ripgrep", &[ripgrep_name], &["--version"], "ripgrep ").await;
    let uv = inspect_version_command("uv", &[uv_name], &["--version"], "uv ").await;
    let gh = inspect_version_command("GitHub CLI", &[gh_name], &["--version"], "gh version ").await;
    vec![python, node, npm, git, ffmpeg, ffprobe, ripgrep, uv, gh]
}

use crate::storage::product_storage;
use chrono::Local;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    time::SystemTime,
};
use tokio::io::{AsyncBufReadExt, BufReader};

pub(crate) fn append_client_event(storage: &Path, event: &str) -> Result<(), String> {
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

pub(crate) async fn capture_backend_output<R: tokio::io::AsyncRead + Unpin>(
    storage: PathBuf,
    stream: R,
    name: &'static str,
) {
    capture_process_output(storage, stream, name, "hermes-backend-").await;
}

pub(crate) async fn capture_browser_output<R: tokio::io::AsyncRead + Unpin>(
    storage: PathBuf,
    stream: R,
    name: String,
) {
    capture_process_output(storage, stream, &name, "chromium-").await;
}

async fn capture_process_output<R: tokio::io::AsyncRead + Unpin>(
    storage: PathBuf,
    stream: R,
    name: &str,
    prefix: &str,
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
                let path = logs.join(format!("{prefix}{}.log", now.format("%Y-%m-%d")));
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

pub(crate) fn daily_log_files(storage: &Path, prefix: &str) -> Result<Vec<PathBuf>, String> {
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

pub(crate) fn newest_log_entries_first(content: &str) -> String {
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
pub fn read_diagnostic_logs(
    storage_path: String,
    source: String,
) -> Result<String, DesktopFailure> {
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
        "browser" => ("chromium-", &[]),
        _ => return Err(DesktopFailure::invalid_input()),
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
pub fn record_client_event(storage_path: String, event: String) -> Result<(), DesktopFailure> {
    if !matches!(
        event.as_str(),
        "startup_failed" | "connection_failed" | "reconnect_failed" | "stop_failed"
    ) {
        return Err(DesktopFailure::invalid_input());
    }
    append_client_event(&product_storage(Path::new(&storage_path))?, &event).map_err(Into::into)
}

#[cfg(test)]
#[path = "tests/diagnostics.rs"]
mod contract_tests;
