use super::BackendState;
use crate::diagnostics::capture_browser_output;
use crate::errors::DesktopFailure;
use crate::process_manager::{self, ProcessRegistration};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::State;
use tokio::{
    process::{Child, Command},
    sync::Mutex,
    time::sleep,
};

#[derive(Default)]
pub struct BrowserBridgeState(Mutex<HashMap<String, BrowserInstance>>);

struct BrowserInstance {
    child: Child,
    port: u16,
    connected_epoch: Option<String>,
    _process: ProcessRegistration,
}

impl Drop for BrowserInstance {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

fn chromium_executable(storage: &Path, bundled: Option<&Path>) -> Option<PathBuf> {
    let candidates = [
        bundled.map(Path::to_path_buf),
        Some(storage.join("hermes-home/tools")),
    ];
    for root in candidates.into_iter().flatten() {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_name().to_string_lossy().starts_with("chromium-") {
                continue;
            }
            let base = entry.path();
            for relative in [
                "chrome-win64/chrome.exe",
                "chrome-linux64/chrome",
                "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
            ] {
                let file = base.join(relative);
                if file.is_file() {
                    return Some(file);
                }
            }
        }
    }
    None
}

async fn start_chromium(
    chrome: &Path,
    profile_dir: &Path,
    storage: &Path,
    profile: &str,
) -> Result<BrowserInstance, DesktopFailure> {
    fs::create_dir_all(profile_dir).map_err(|_| DesktopFailure::operation_failed())?;
    let _ = fs::remove_file(profile_dir.join("DevToolsActivePort"));
    let mut command = Command::new(chrome);
    command
        .args([
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=0",
        ])
        .arg(format!("--user-data-dir={}", profile_dir.display()))
        .arg("about:blank")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let (mut child, registration) = process_manager::spawn(&mut command, "browser_cdp")
        .map_err(|_| DesktopFailure::operation_failed())?;
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(capture_browser_output(
            storage.to_path_buf(),
            stdout,
            format!("{profile}/stdout"),
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(capture_browser_output(
            storage.to_path_buf(),
            stderr,
            format!("{profile}/stderr"),
        ));
    }
    let active = profile_dir.join("DevToolsActivePort");
    for _ in 0..50 {
        if let Ok(contents) = fs::read_to_string(&active) {
            if let Some(port) = contents
                .lines()
                .next()
                .and_then(|line| line.parse::<u16>().ok())
            {
                return Ok(BrowserInstance {
                    child,
                    port,
                    connected_epoch: None,
                    _process: registration,
                });
            }
        }
        if child
            .try_wait()
            .map_err(|_| DesktopFailure::operation_failed())?
            .is_some()
        {
            return Err(DesktopFailure::operation_failed());
        }
        sleep(Duration::from_millis(200)).await;
    }
    let _ = child.start_kill();
    Err(DesktopFailure::timeout())
}

impl BrowserBridgeState {
    pub async fn ensure(
        &self,
        backend: &BackendState,
        profile: &str,
        session_id: &str,
    ) -> Result<u16, DesktopFailure> {
        if session_id.is_empty() || session_id.len() > 256 {
            return Err(DesktopFailure::invalid_input());
        }
        let scope = backend.resolve_profile(profile).await?;
        let storage = scope.storage.clone();
        let bundled = scope.bundled_tools_root.clone();
        let profile = scope.profile.clone();
        let epoch = scope.gateway_epoch.clone();
        scope
            .gateway
            .request("session.resume", json!({"session_id": session_id}))
            .await?;
        scope.ensure_current(backend).await?;
        let mut browsers = self.0.lock().await;
        let dead = browsers
            .get_mut(&profile)
            .is_some_and(|instance| instance.child.try_wait().ok().flatten().is_some());
        if dead {
            browsers.remove(&profile);
        }
        if !browsers.contains_key(&profile) {
            let chrome = chromium_executable(&storage, bundled.as_deref())
                .ok_or_else(DesktopFailure::runtime_unavailable)?;
            let folder = storage.join("browser-bridge").join(&profile);
            browsers.insert(
                profile.clone(),
                start_chromium(&chrome, &folder, &storage, &profile).await?,
            );
        }
        let instance = browsers
            .get(&profile)
            .ok_or_else(DesktopFailure::operation_failed)?;
        let port = instance.port;
        if instance.connected_epoch.as_deref() != Some(&epoch) {
            let connected = async {
                scope.ensure_current(backend).await?;
                let result = scope
                    .gateway
                    .request(
                        "browser.manage",
                        json!({"action":"connect", "session_id":session_id,
                        "url":format!("http://127.0.0.1:{port}")}),
                    )
                    .await?;
                scope.ensure_current(backend).await?;
                if result.get("connected").and_then(Value::as_bool) != Some(true) {
                    return Err(DesktopFailure::operation_failed());
                }
                Ok(())
            }
            .await;
            if let Err(cause) = connected {
                browsers.remove(&profile);
                let _ = crate::diagnostics::append_client_event(&storage, &format!("browser_connect_cleanup profile={profile} session={session_id} result=closed"));
                return Err(cause);
            }
            if let Some(instance) = browsers.get_mut(&profile) {
                instance.connected_epoch = Some(epoch);
            }
        }
        Ok(port)
    }

    pub async fn stop_all(&self) {
        self.0.lock().await.clear();
    }

    pub async fn close(
        &self,
        backend: &BackendState,
        profile: &str,
        session_id: &str,
    ) -> Result<(), DesktopFailure> {
        if session_id.is_empty() || session_id.len() > 256 {
            return Err(DesktopFailure::invalid_input());
        }
        let scope = backend.resolve_profile(profile).await?;
        let profile = scope.profile.clone();
        let epoch = scope.gateway_epoch.clone();
        scope
            .gateway
            .request("session.resume", json!({"session_id": session_id}))
            .await?;
        scope.ensure_current(backend).await?;
        let mut browsers = self.0.lock().await;
        let Some(instance) = browsers.get(&profile) else {
            return Ok(());
        };
        let disconnected = if instance.connected_epoch.as_deref() == Some(&epoch) {
            async {
                scope.ensure_current(backend).await?;
                scope
                    .gateway
                    .request(
                        "browser.manage",
                        json!({"action":"disconnect", "session_id":session_id}),
                    )
                    .await?;
                Ok(())
            }
            .await
        } else {
            Ok(())
        };
        browsers.remove(&profile);
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "browser_disconnect_cleanup profile={profile} session={session_id} result=closed"
            ),
        );
        disconnected
    }
}

#[tauri::command]
pub async fn open_visible_browser(
    backend: State<'_, BackendState>,
    browser_bridge: State<'_, BrowserBridgeState>,
    profile: String,
    session_id: String,
) -> Result<(), DesktopFailure> {
    browser_bridge
        .ensure(&backend, &profile, &session_id)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn close_visible_browser(
    backend: State<'_, BackendState>,
    browser_bridge: State<'_, BrowserBridgeState>,
    profile: String,
    session_id: String,
) -> Result<(), DesktopFailure> {
    browser_bridge.close(&backend, &profile, &session_id).await
}

#[cfg(all(test, windows))]
#[path = "tests/browser_bridge.rs"]
mod tests;
