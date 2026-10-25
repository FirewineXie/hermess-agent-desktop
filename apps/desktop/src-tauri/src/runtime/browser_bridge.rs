use super::BackendState;
use crate::diagnostics::capture_browser_output;
use crate::errors::DesktopFailure;
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
    #[cfg(windows)]
    _job: BrowserJob,
}

#[cfg(windows)]
struct BrowserJob(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl BrowserJob {
    fn new() -> std::io::Result<Self> {
        use std::os::windows::io::FromRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let handle = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let result = unsafe {
            SetInformationJobObject(
                raw,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if result == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self(handle))
    }

    fn assign(&self, pid: u32) -> std::io::Result<()> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        let raw = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if raw.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let process = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw) };
        if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), process.as_raw_handle()) } == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
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
    #[cfg(windows)]
    let job = BrowserJob::new().map_err(|_| DesktopFailure::operation_failed())?;
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
    let mut child = command
        .spawn()
        .map_err(|_| DesktopFailure::operation_failed())?;
    #[cfg(windows)]
    if child.id().is_none_or(|pid| job.assign(pid).is_err()) {
        let _ = child.start_kill();
        return Err(DesktopFailure::operation_failed());
    }
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
                    #[cfg(windows)]
                    _job: job,
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
            browsers.insert(
                profile.clone(),
                start_chromium(&chrome, &folder, &storage, &profile).await?,
            );
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

    pub async fn close(
        &self,
        backend: &BackendState,
        session_id: &str,
    ) -> Result<(), DesktopFailure> {
        if session_id.is_empty() || session_id.len() > 256 {
            return Err(DesktopFailure::invalid_input());
        }
        let (profile, epoch) = {
            let owned = backend.0.lock().await;
            let current = owned
                .as_ref()
                .ok_or_else(DesktopFailure::runtime_unavailable)?;
            (
                current.selected_profile.clone(),
                current.gateway.replay_epoch.clone(),
            )
        };
        let gateway = backend.gateway().await?;
        let mut browsers = self.0.lock().await;
        let Some(instance) = browsers.get(&profile) else {
            return Ok(());
        };
        if instance.connected_epoch.as_deref() == Some(&epoch) {
            gateway
                .request(
                    "browser.manage",
                    json!({"action":"disconnect", "session_id":session_id}),
                )
                .await?;
        }
        browsers.remove(&profile);
        Ok(())
    }
}

#[tauri::command]
pub async fn open_visible_browser(
    backend: State<'_, BackendState>,
    browser_bridge: State<'_, BrowserBridgeState>,
    session_id: String,
) -> Result<(), DesktopFailure> {
    browser_bridge.ensure(&backend, &session_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn close_visible_browser(
    backend: State<'_, BackendState>,
    browser_bridge: State<'_, BrowserBridgeState>,
    session_id: String,
) -> Result<(), DesktopFailure> {
    browser_bridge.close(&backend, &session_id).await
}

#[cfg(all(test, windows))]
#[path = "tests/browser_bridge.rs"]
mod tests;
