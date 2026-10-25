use super::BackendState;
use crate::errors::DesktopFailure;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;
use tokio::{
    process::{Child, Command},
    sync::Mutex,
    time::{sleep, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Default)]
pub struct BrowserBridgeState(Mutex<HashMap<String, BrowserInstance>>);

struct BrowserInstance {
    child: Child,
    port: u16,
    connected_epoch: Option<String>,
}

impl Drop for BrowserInstance {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[derive(Clone, Serialize)]
pub struct BrowserTarget {
    id: String,
    title: String,
    url: String,
}

#[derive(Serialize)]
pub struct BrowserFrame {
    image: String,
    target: BrowserTarget,
    targets: Vec<BrowserTarget>,
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
) -> Result<BrowserInstance, DesktopFailure> {
    fs::create_dir_all(profile_dir).map_err(|_| DesktopFailure::operation_failed())?;
    let _ = fs::remove_file(profile_dir.join("DevToolsActivePort"));
    let mut command = Command::new(chrome);
    command
        .args([
            "--headless=new",
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=0",
        ])
        .arg(format!("--user-data-dir={}", profile_dir.display()))
        .arg("about:blank")
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .spawn()
        .map_err(|_| DesktopFailure::operation_failed())?;
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
        session_id: &str,
    ) -> Result<u16, DesktopFailure> {
        if session_id.is_empty() || session_id.len() > 256 {
            return Err(DesktopFailure::invalid_input());
        }
        let (profile, storage, bundled, epoch) = {
            let owned = backend.0.lock().await;
            let current = owned
                .as_ref()
                .ok_or_else(DesktopFailure::runtime_unavailable)?;
            (
                current.selected_profile.clone(),
                current.storage.clone(),
                current.bundled_tools_root.clone(),
                current.gateway.replay_epoch.clone(),
            )
        };
        let gateway = backend.gateway().await?;
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
            browsers.insert(profile.clone(), start_chromium(&chrome, &folder).await?);
        }
        let instance = browsers
            .get_mut(&profile)
            .ok_or_else(DesktopFailure::operation_failed)?;
        if instance.connected_epoch.as_deref() != Some(&epoch) {
            let result = gateway
                .request(
                    "browser.manage",
                    json!({"action":"connect", "session_id":session_id,
                "url":format!("http://127.0.0.1:{}", instance.port)}),
                )
                .await?;
            if result.get("connected").and_then(Value::as_bool) != Some(true) {
                return Err(DesktopFailure::operation_failed());
            }
            instance.connected_epoch = Some(epoch);
        }
        Ok(instance.port)
    }

    pub async fn stop_all(&self) {
        self.0.lock().await.clear();
    }
}

async fn targets(port: u16) -> Result<Vec<BrowserTarget>, DesktopFailure> {
    let response: Value = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?
        .get(format!("http://127.0.0.1:{port}/json/list"))
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(response
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row.get("type").and_then(Value::as_str) == Some("page"))
        .filter_map(|row| {
            Some(BrowserTarget {
                id: row.get("id")?.as_str()?.to_owned(),
                title: row
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                url: row
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
            })
        })
        .collect())
}

async fn cdp(
    port: u16,
    target: &str,
    method: &str,
    params: Value,
) -> Result<Value, DesktopFailure> {
    if !target.bytes().all(|byte| byte.is_ascii_hexdigit()) || target.is_empty() {
        return Err(DesktopFailure::invalid_input());
    }
    let url = format!("ws://127.0.0.1:{port}/devtools/page/{target}");
    let (mut socket, _) = timeout(Duration::from_secs(5), connect_async(url))
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| DesktopFailure::connection_lost())?;
    socket
        .send(Message::Text(
            json!({"id":1,"method":method,"params":params})
                .to_string()
                .into(),
        ))
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    for _ in 0..32 {
        let message = timeout(Duration::from_secs(5), socket.next())
            .await
            .map_err(|_| DesktopFailure::timeout())?
            .ok_or_else(DesktopFailure::connection_lost)?
            .map_err(|_| DesktopFailure::connection_lost())?;
        if let Message::Text(text) = message {
            let value: Value =
                serde_json::from_str(&text).map_err(|_| DesktopFailure::operation_failed())?;
            if value.get("id").and_then(Value::as_u64) == Some(1) {
                return value
                    .get("result")
                    .cloned()
                    .ok_or_else(DesktopFailure::operation_failed);
            }
        }
    }
    Err(DesktopFailure::timeout())
}

async fn valid_target(port: u16, id: &str) -> Result<(), DesktopFailure> {
    if targets(port).await?.iter().any(|target| target.id == id) {
        Ok(())
    } else {
        Err(DesktopFailure::invalid_input())
    }
}

#[tauri::command]
pub async fn browser_bridge_frame(
    backend: State<'_, BackendState>,
    bridge: State<'_, BrowserBridgeState>,
    session_id: String,
    target_id: Option<String>,
) -> Result<BrowserFrame, DesktopFailure> {
    let port = bridge.ensure(&backend, &session_id).await?;
    let targets = targets(port).await?;
    let target = target_id
        .and_then(|id| targets.iter().find(|row| row.id == id))
        .or_else(|| {
            targets
                .iter()
                .find(|row| row.url.starts_with("http") || row.url.starts_with("data:"))
        })
        .or_else(|| targets.first())
        .ok_or_else(DesktopFailure::operation_failed)?
        .clone();
    let result = cdp(
        port,
        &target.id,
        "Page.captureScreenshot",
        json!({"format":"jpeg","quality":65}),
    )
    .await?;
    let image = result
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?
        .to_owned();
    Ok(BrowserFrame {
        image,
        target,
        targets,
    })
}

#[tauri::command]
pub async fn browser_bridge_command(
    backend: State<'_, BackendState>,
    bridge: State<'_, BrowserBridgeState>,
    session_id: String,
    target_id: String,
    method: String,
    params: Value,
) -> Result<(), DesktopFailure> {
    let allowed = [
        "Page.navigate",
        "Page.reload",
        "Browser.back",
        "Browser.forward",
        "Input.dispatchMouseEvent",
        "Input.dispatchKeyEvent",
        "Input.insertText",
    ];
    if !allowed.contains(&method.as_str()) {
        return Err(DesktopFailure::invalid_input());
    }
    if method == "Page.navigate" {
        let url = params
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(DesktopFailure::invalid_input)?;
        if !matches!(
            reqwest::Url::parse(url)
                .ok()
                .map(|url| url.scheme().to_owned())
                .as_deref(),
            Some("http" | "https")
        ) {
            return Err(DesktopFailure::invalid_input());
        }
    }
    let port = bridge.ensure(&backend, &session_id).await?;
    valid_target(port, &target_id).await?;
    if method == "Browser.back" || method == "Browser.forward" {
        let history = cdp(port, &target_id, "Page.getNavigationHistory", json!({})).await?;
        let current = history
            .get("currentIndex")
            .and_then(Value::as_i64)
            .ok_or_else(DesktopFailure::operation_failed)?;
        let next = current + if method == "Browser.back" { -1 } else { 1 };
        let entry = history
            .get("entries")
            .and_then(Value::as_array)
            .and_then(|rows| rows.get(next.max(0) as usize));
        if let Some(id) = entry.and_then(|row| row.get("id")).and_then(Value::as_i64) {
            cdp(
                port,
                &target_id,
                "Page.navigateToHistoryEntry",
                json!({"entryId":id}),
            )
            .await?;
        }
    } else {
        cdp(port, &target_id, &method, params).await?;
    }
    Ok(())
}
