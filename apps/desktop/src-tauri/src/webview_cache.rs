use crate::errors::DesktopFailure;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::path::Path;
use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewWindow};

#[cfg(windows)]
use webview2_com::{
    ClearBrowsingDataCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    },
};
#[cfg(windows)]
use windows::core::Interface;

#[cfg(target_os = "macos")]
use objc2_foundation::{NSDate, NSSet};
#[cfg(target_os = "macos")]
use objc2_web_kit::{WKWebView, WKWebsiteDataTypeDiskCache};

const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
static MAINTENANCE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[cfg(windows)]
const MIB: u64 = 1024 * 1024;

#[derive(Serialize)]
pub struct WebviewCacheSettings {
    strategy: &'static str,
    value: u32,
}

#[derive(Deserialize, Serialize)]
struct SavedPolicy {
    schema: u32,
    value: u32,
}

fn strategy() -> &'static str {
    if cfg!(windows) {
        "size"
    } else if cfg!(target_os = "macos") {
        "time"
    } else {
        "unsupported"
    }
}

fn default_value() -> u32 {
    if cfg!(windows) {
        512
    } else if cfg!(target_os = "macos") {
        30
    } else {
        0
    }
}

fn valid_value(value: u32) -> bool {
    match strategy() {
        "size" => matches!(value, 0 | 256 | 512 | 1024),
        "time" => matches!(value, 0 | 7 | 30 | 90),
        _ => false,
    }
}

fn policy_path(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    app.path()
        .app_config_dir()
        .map(|root| root.join("webview-cache.json"))
        .map_err(|_| DesktopFailure::operation_failed())
}

fn read_value(app: &AppHandle) -> Result<u32, DesktopFailure> {
    let path = policy_path(app)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(default_value()),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    let policy: SavedPolicy =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    if policy.schema != 1 || !valid_value(policy.value) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(policy.value)
}

#[tauri::command]
pub fn get_webview_cache_settings(app: AppHandle) -> Result<WebviewCacheSettings, DesktopFailure> {
    Ok(WebviewCacheSettings {
        strategy: strategy(),
        value: if strategy() == "unsupported" {
            0
        } else {
            read_value(&app)?
        },
    })
}

#[tauri::command]
pub fn set_webview_cache_settings(app: AppHandle, value: u32) -> Result<(), DesktopFailure> {
    if !valid_value(value) {
        return Err(DesktopFailure::invalid_input());
    }
    let path = policy_path(&app)?;
    fs::create_dir_all(path.parent().ok_or_else(DesktopFailure::operation_failed)?)
        .map_err(|_| DesktopFailure::operation_failed())?;
    fs::write(
        path,
        serde_json::to_vec(&SavedPolicy { schema: 1, value })
            .map_err(|_| DesktopFailure::operation_failed())?,
    )
    .map_err(|_| DesktopFailure::operation_failed())?;
    tauri::async_runtime::spawn(async move { maintain(&app).await });
    Ok(())
}

#[tauri::command]
pub async fn clear_webview_cache_now(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), DesktopFailure> {
    let _guard = MAINTENANCE.lock().await;
    if strategy() == "unsupported" || !clear_disk_cache(window).await {
        return Err(DesktopFailure::operation_failed());
    }
    if let Ok(marker) = marker_path(&app) {
        let _ = write_marker(&marker, now_seconds());
    }
    Ok(())
}

pub(crate) fn start(app: AppHandle) {
    if strategy() == "unsupported" {
        return;
    }
    tauri::async_runtime::spawn(async move {
        // The configured WebView must exist before its profile can clear data.
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            maintain(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn marker_path(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    app.path()
        .app_local_data_dir()
        .map(|root| root.join("webview-cache-last-clear"))
        .map_err(|_| DesktopFailure::operation_failed())
}

fn write_marker(path: &PathBuf, now: u64) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, now.to_string())
}

async fn maintain(app: &AppHandle) {
    let _guard = MAINTENANCE.lock().await;
    let Ok(value) = read_value(app) else { return };
    if value == 0 {
        return;
    }
    let Ok(marker) = marker_path(app) else { return };
    let now = now_seconds();
    let last = fs::read_to_string(&marker)
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok());
    if cfg!(target_os = "macos") && last.is_none() {
        let _ = write_marker(&marker, now);
        return;
    }
    if let Some(last) = last {
        let wait_days = if cfg!(windows) { 1 } else { value as u64 };
        if now.saturating_sub(last) < wait_days * CHECK_INTERVAL.as_secs() {
            return;
        }
    }

    #[cfg(windows)]
    {
        let Ok(local) = app.path().app_local_data_dir() else {
            return;
        };
        let cache = local.join("EBWebView");
        let limit = value as u64 * MIB;
        let Ok(Ok(over_limit)) =
            tokio::task::spawn_blocking(move || directory_exceeds_limit(&cache, limit)).await
        else {
            return;
        };
        if !over_limit {
            return;
        }
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if clear_disk_cache(window).await {
        let _ = write_marker(&marker, now);
    }
}

#[cfg(windows)]
fn directory_exceeds_limit(root: &Path, limit: u64) -> std::io::Result<bool> {
    let root_metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Ok(false);
    }
    let mut pending = vec![root.to_path_buf()];
    let mut total = 0u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
                if total > limit {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

#[cfg(windows)]
async fn clear_disk_cache(window: WebviewWindow) -> bool {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if window
        .with_webview(move |webview| {
            let _ = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_13>())
                    .and_then(|core| core.Profile())
                    .and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
                    .and_then(|profile| {
                        profile.ClearBrowsingData(
                            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
                            &ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
                                let _ = sender.send(result.is_ok());
                                Ok(())
                            })),
                        )
                    })
            };
        })
        .is_err()
    {
        return false;
    }
    matches!(
        tokio::time::timeout(Duration::from_secs(30), receiver).await,
        Ok(Ok(true))
    )
}

#[cfg(target_os = "macos")]
async fn clear_disk_cache(window: WebviewWindow) -> bool {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    if window
        .with_webview(move |webview| unsafe {
            let view: &WKWebView = &*webview.inner().cast();
            let store = view.configuration().websiteDataStore();
            let types = NSSet::setWithObject(WKWebsiteDataTypeDiskCache);
            let since = NSDate::dateWithTimeIntervalSince1970(0.0);
            let completed = block2::RcBlock::new(move || {
                let _ = sender.send(());
            });
            store.removeDataOfTypes_modifiedSince_completionHandler(&types, &since, &completed);
        })
        .is_err()
    {
        return false;
    }
    matches!(
        tokio::time::timeout(Duration::from_secs(30), receiver.recv()).await,
        Ok(Some(()))
    )
}

#[cfg(not(any(windows, target_os = "macos")))]
async fn clear_disk_cache(_window: WebviewWindow) -> bool {
    false
}

#[cfg(test)]
#[path = "tests/webview_cache.rs"]
mod tests;
