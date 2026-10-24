#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{env, path::PathBuf, time::Duration};
use tokio::{process::Command, time::timeout};

mod backend;
mod gateway;

#[derive(Serialize)]
struct RuntimeProbe {
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
        match timeout(Duration::from_secs(4), command.output()).await {
            Ok(Ok(output)) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_owned();
                if version
                    .strip_prefix(version_prefix)
                    .is_some_and(|remainder| !remainder.trim().is_empty())
                {
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
    vec![python, node, git, ffmpeg, ffprobe, ripgrep, uv, gh]
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
            backend::read_diagnostic_logs,
            backend::record_client_event,
            backend::create_chat_session,
            backend::submit_chat_prompt,
            backend::list_composer_commands,
            backend::execute_composer_command,
            backend::dispatch_composer_skill,
            backend::attach_chat_file,
            backend::detach_chat_image,
            backend::answer_gateway_request,
            backend::list_chat_sessions,
            backend::list_bundled_tools,
            backend::list_agent_toolsets,
            backend::list_active_agent_tools,
            backend::list_model_options,
            backend::select_chat_model,
            backend::get_saved_model_config,
            backend::get_agent_config,
            backend::get_agent_config_schema,
            backend::get_agent_config_raw,
            backend::save_auxiliary_route,
            backend::get_chat_reasoning,
            backend::get_chat_usage,
            backend::list_custom_endpoints,
            backend::load_model_lists,
            backend::save_model_lists,
            backend::add_custom_endpoint,
            backend::delete_custom_endpoint,
            backend::save_agent_config_field,
            backend::save_agent_config_raw,
            backend::check_model_runtime,
            backend::set_default_model,
            backend::resume_chat_session,
            backend::interrupt_chat_session,
            backend::replay_chat_events
        ])
        .run(tauri::generate_context!())
        .expect("无法启动桌面程序");
}
