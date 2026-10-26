use super::BackendState;
use crate::errors::DesktopFailure;
use crate::process_manager;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::State;
use tokio::{process::Command, time::timeout};

// Desktop-relevant PM tools omitted by the core payload. The full Windows
// payload contains most of these; other targets have their own pinned tools.
// Names are fixed here so the webview cannot turn this command into an arbitrary PM install.
const OPTIONAL_TOOLS: &[&str] = &[
    "agent-browser",
    "bws",
    "chromium",
    "cua-driver",
    "ffmpeg",
    "gh",
    "git",
    "llamacpp-cpu",
    "llamacpp-cuda",
    "llamacpp-hip",
    "llamacpp-metal",
    "llamacpp-vulkan",
    "node",
    "npm",
    "ripgrep",
    "whispercpp-cpu",
];

#[derive(Serialize)]
pub struct DownloadableTool {
    name: String,
    version: String,
    installed: bool,
    supported: bool,
}

fn current_target() -> &'static str {
    if cfg!(all(windows, target_arch = "x86_64")) {
        "win32-x64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "darwin-x64"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "darwin-arm64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "linux-x64"
    } else {
        "unsupported"
    }
}

fn lock_path(hermes: &Path) -> PathBuf {
    let payload = hermes.parent().and_then(Path::parent);
    if let Some(root) = payload.filter(|root| root.join("manifest.json").is_file()) {
        return root.join("hermes-agent/pm/lock.json");
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../upstream/hermes-agent/pm/lock.json")
}

fn read_json(path: &Path) -> Result<Value, DesktopFailure> {
    serde_json::from_slice(&fs::read(path).map_err(|_| DesktopFailure::operation_failed())?)
        .map_err(|_| DesktopFailure::operation_failed())
}

fn recorded(root: &Path, name: &str, version: &str, target: &str) -> bool {
    let Ok(facts) = read_json(&root.join("facts.json")) else {
        return false;
    };
    let Some(fact) = facts.pointer(&format!("/packages/{name}")) else {
        return false;
    };
    let Some(entry) = fact.get("entry").and_then(Value::as_str) else {
        return false;
    };
    Path::new(entry).components().count() == 1
        && fact.get("version").and_then(Value::as_str) == Some(version)
        && fact.get("target").and_then(Value::as_str) == Some(target)
        && root.join(entry).is_dir()
}

fn catalogue(hermes: &Path, home: &Path) -> Result<Vec<DownloadableTool>, DesktopFailure> {
    let lock = read_json(&lock_path(hermes))?;
    let packages = lock
        .get("packages")
        .and_then(Value::as_object)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let target = current_target();
    let core = hermes
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("tools"));
    let writable = home.join("tools");
    Ok(OPTIONAL_TOOLS
        .iter()
        .filter_map(|name| {
            let package = packages.get(*name)?;
            let version = package.get("version")?.as_str()?;
            let artifacts = package.get("artifacts")?.as_object()?;
            Some(DownloadableTool {
                name: (*name).to_owned(),
                version: version.to_owned(),
                supported: artifacts.contains_key(target) || artifacts.contains_key("any"),
                installed: core
                    .as_ref()
                    .is_some_and(|root| recorded(root, name, version, target))
                    || recorded(&writable, name, version, target),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn list_downloadable_tools(
    state: State<'_, BackendState>,
) -> Result<Vec<DownloadableTool>, DesktopFailure> {
    let owned = state.0.lock().await;
    let backend = owned
        .as_ref()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    catalogue(&backend.hermes, &backend.storage.join("hermes-home"))
}

#[tauri::command]
pub async fn install_downloadable_tool(
    state: State<'_, BackendState>,
    name: String,
) -> Result<(), DesktopFailure> {
    if !OPTIONAL_TOOLS.contains(&name.as_str()) {
        return Err(DesktopFailure::invalid_input());
    }
    let _install_gate = state.1.try_lock().map_err(|_| DesktopFailure::conflict())?;
    let (hermes, home, storage) = {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        (
            backend.hermes.clone(),
            backend.storage.join("hermes-home"),
            backend.storage.clone(),
        )
    };
    let selected = catalogue(&hermes, &home)?
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if !selected.supported {
        return Err(DesktopFailure::invalid_input());
    }
    fs::create_dir_all(storage.join("logs")).map_err(|_| DesktopFailure::operation_failed())?;
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(storage.join("logs/tool-install.log"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    let stderr = log
        .try_clone()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut command = Command::new(&hermes);
    command
        .args(["pm", "install", &name])
        .env("HERMES_HOME", &home)
        .env("HERMES_DISABLE_LAZY_INSTALLS", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let status = timeout(
        Duration::from_secs(1800),
        process_manager::status(&mut command, "tool_install"),
    )
    .await
    .map_err(|_| DesktopFailure::timeout())?
    .map_err(|_| DesktopFailure::operation_failed())?;
    if !status.success() {
        return Err(DesktopFailure::operation_failed());
    }
    let installed = catalogue(&hermes, &home)?
        .into_iter()
        .any(|tool| tool.name == name && tool.installed);
    if installed {
        Ok(())
    } else {
        Err(DesktopFailure::operation_failed())
    }
}

#[cfg(test)]
#[path = "tests/downloadable_tools.rs"]
mod tests;
