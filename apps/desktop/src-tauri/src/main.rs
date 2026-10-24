#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{env, path::PathBuf, time::Duration};
use tokio::{process::Command, time::timeout};

mod backend;
mod gateway;

#[derive(Serialize)]
struct RuntimeProbe {
    tool: &'static str,
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
        command.kill_on_drop(true);
        match timeout(Duration::from_secs(4), command.output()).await {
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
        path: None,
        version: None,
        usable: false,
        reason: last_reason,
    }
}

#[tauri::command]
async fn probe_local_tools() -> Vec<RuntimeProbe> {
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
    vec![python, node]
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend::BackendState::default())
        .invoke_handler(tauri::generate_handler![
            probe_local_tools,
            backend::dev_backend_defaults,
            backend::start_dev_backend,
            backend::packed_backend_defaults,
            backend::start_packed_backend,
            backend::ping_backend,
            backend::reconnect_backend,
            backend::stop_backend,
            backend::create_chat_session,
            backend::submit_chat_prompt,
            backend::attach_chat_file,
            backend::detach_chat_image,
            backend::answer_gateway_request,
            backend::list_chat_sessions,
            backend::list_model_options,
            backend::check_model_runtime,
            backend::set_default_model,
            backend::resume_chat_session,
            backend::interrupt_chat_session,
            backend::replay_chat_events
        ])
        .run(tauri::generate_context!())
        .expect("无法启动桌面程序");
}
