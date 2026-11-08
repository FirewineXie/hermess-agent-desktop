//! Optional, product-owned runtime. No PATH lookup or installer scripts.
use super::coding_config;
use crate::{
    diagnostics::log_client_event,
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path, CanonicalizePlain},
};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, State};
use tokio::{io::AsyncWriteExt, sync::Mutex};

#[derive(Deserialize)]
struct RuntimeLock {
    repository: String,
    tag: String,
    version: String,
    assets: HashMap<String, Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    sha256: String,
}
#[derive(Clone, Serialize)]
pub struct RuntimeStatus {
    pub tag: String,
    pub version: String,
    pub supported: bool,
    pub state: String,
    pub downloaded: u64,
    pub total: u64,
}
#[derive(Default)]
pub struct CodingRuntimeState {
    gate: Mutex<()>,
    progress: Mutex<Option<RuntimeStatus>>,
}

fn lock() -> Result<RuntimeLock, DesktopFailure> {
    serde_json::from_str(include_str!("../../../../../runtime/codex.lock.json"))
        .map_err(|_| DesktopFailure::operation_failed())
}
fn target() -> &'static str {
    if cfg!(all(windows, target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-musl"
    } else {
        "unsupported"
    }
}
fn directory(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    coding_config::owned(app, &Path::new("runtime").join(lock()?.tag).join(target()))
}
fn binary_name() -> &'static str {
    if cfg!(windows) {
        "bin/codex.exe"
    } else {
        "bin/codex"
    }
}

pub(super) fn executable(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    let root = directory(app)?;
    let relative = Path::new("runtime").join(lock()?.tag).join(target());
    coding_config::owned(app, &relative.join(".hermess-verified"))?;
    coding_config::owned(app, &relative.join(binary_name()))?;
    if !filesystem_path(&root.join(".hermess-verified")).is_file() {
        return Err(DesktopFailure::runtime_unavailable());
    }
    let canonical = root
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::runtime_unavailable())?;
    let executable = root
        .join(binary_name())
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::runtime_unavailable())?;
    if !executable.starts_with(canonical) || !filesystem_path(&executable).is_file() {
        return Err(DesktopFailure::runtime_unavailable());
    }
    Ok(plain_path(&executable))
}

#[tauri::command]
pub async fn get_coding_runtime(
    app: AppHandle,
    state: State<'_, CodingRuntimeState>,
) -> Result<RuntimeStatus, DesktopFailure> {
    let installed = executable(&app).is_ok();
    if let Some(progress) = state
        .progress
        .lock()
        .await
        .as_ref()
        .filter(|p| p.state != "installed" && !installed)
    {
        return Ok(progress.clone());
    }
    let lock = lock()?;
    Ok(RuntimeStatus {
        supported: lock.assets.contains_key(target()),
        tag: lock.tag,
        version: lock.version,
        state: if installed { "installed" } else { "missing" }.into(),
        downloaded: 0,
        total: 0,
    })
}

// Reject traversal, links, duplicate files, and excessive expansion before publishing a runtime.
fn extract(archive: &Path, destination: &Path) -> Result<(), DesktopFailure> {
    let file =
        fs::File::open(filesystem_path(archive)).map_err(|_| DesktopFailure::operation_failed())?;
    let mut archive = tar::Archive::new(GzDecoder::new(file));
    let mut expanded = 0u64;
    for entry in archive
        .entries()
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        let mut entry = entry.map_err(|_| DesktopFailure::operation_failed())?;
        let relative = entry
            .path()
            .map_err(|_| DesktopFailure::invalid_input())?
            .into_owned();
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(DesktopFailure::invalid_input());
        }
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err(DesktopFailure::invalid_input());
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or_else(DesktopFailure::invalid_input)?;
        if expanded > 2 * 1024 * 1024 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        let path = filesystem_path(&destination.join(relative));
        if kind.is_dir() {
            fs::create_dir_all(&path).map_err(|_| DesktopFailure::operation_failed())?;
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|_| DesktopFailure::operation_failed())?;
            }
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|_| DesktopFailure::operation_failed())?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|_| DesktopFailure::operation_failed())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = entry
                    .header()
                    .mode()
                    .map_err(|_| DesktopFailure::invalid_input())?;
                fs::set_permissions(&path, fs::Permissions::from_mode(mode & 0o755))
                    .map_err(|_| DesktopFailure::operation_failed())?;
            }
        }
    }
    if !filesystem_path(&destination.join(binary_name())).is_file() {
        return Err(DesktopFailure::runtime_unavailable());
    }
    fs::write(
        filesystem_path(&destination.join(".hermess-verified")),
        lock()?.tag,
    )
    .map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn install_coding_runtime(
    app: AppHandle,
    state: State<'_, CodingRuntimeState>,
) -> Result<(), DesktopFailure> {
    let _guard = state
        .gate
        .try_lock()
        .map_err(|_| DesktopFailure::conflict())?;
    if executable(&app).is_ok() {
        *state.progress.lock().await = None;
        log_client_event("programming_runtime_install_reused success=true");
        return Ok(());
    }
    let lock = lock()?;
    let asset = lock
        .assets
        .get(target())
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    let destination = directory(&app)?;
    super::coding_vault::private_directory(&coding_config::root(&app)?)?;
    let parent = destination
        .parent()
        .ok_or_else(DesktopFailure::operation_failed)?;
    fs::create_dir_all(filesystem_path(parent)).map_err(|_| DesktopFailure::operation_failed())?;
    let operation = uuid::Uuid::new_v4();
    let staging = parent.join(format!(".download-{operation}"));
    fs::create_dir(filesystem_path(&staging)).map_err(|_| DesktopFailure::operation_failed())?;
    let archive = staging.join("runtime.tar.gz");
    let extracted = staging.join("extracted");
    let progress = RuntimeStatus {
        tag: lock.tag.clone(),
        version: lock.version.clone(),
        supported: true,
        state: "downloading".into(),
        downloaded: 0,
        total: asset.size,
    };
    *state.progress.lock().await = Some(progress);
    log_client_event(&format!(
        "programming_runtime_download_start operation={operation} tag={}",
        lock.tag
    ));
    let result = async {
        let client = reqwest::Client::builder()
            .user_agent("Hermess-Agent-Desktop")
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(900))
            .build()
            .map_err(|_| DesktopFailure::operation_failed())?;
        let url = format!(
            "https://github.com/{}/releases/download/{}/{}",
            lock.repository, lock.tag, asset.name
        );
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|_| DesktopFailure::connection_lost())?
            .error_for_status()
            .map_err(|_| DesktopFailure::connection_lost())?;
        let mut file = tokio::fs::File::create(filesystem_path(&archive))
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0u64;
        while let Some(bytes) = response
            .chunk()
            .await
            .map_err(|_| DesktopFailure::connection_lost())?
        {
            downloaded += bytes.len() as u64;
            if downloaded > asset.size {
                return Err(DesktopFailure::invalid_input());
            }
            file.write_all(&bytes)
                .await
                .map_err(|_| DesktopFailure::operation_failed())?;
            hasher.update(&bytes);
            if let Some(status) = state.progress.lock().await.as_mut() {
                status.downloaded = downloaded;
            }
        }
        file.sync_all()
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        drop(file);
        if downloaded != asset.size || format!("{:x}", hasher.finalize()) != asset.sha256 {
            return Err(DesktopFailure::invalid_input());
        }
        if let Some(status) = state.progress.lock().await.as_mut() {
            status.state = "installing".into();
        }
        let archive_path = archive.clone();
        let extracted_path = extracted.clone();
        tokio::task::spawn_blocking(move || extract(&archive_path, &extracted_path))
            .await
            .map_err(|_| DesktopFailure::operation_failed())??;
        // Never replace a live installation. A failed partial directory requires explicit inspection.
        fs::rename(filesystem_path(&extracted), filesystem_path(&destination))
            .map_err(|_| DesktopFailure::operation_failed())?;
        Ok(())
    }
    .await;
    // Only this operation's freshly-created staging directory is removed.
    let cleaned = fs::remove_dir_all(filesystem_path(&staging)).is_ok();
    if let Some(status) = state.progress.lock().await.as_mut() {
        status.state = if result.is_ok() {
            "installed"
        } else {
            "failed"
        }
        .into();
    }
    log_client_event(&format!(
        "{}programming_runtime_download_result operation={operation} success={} cleanup={cleaned}",
        if result.is_err() || !cleaned {
            "ERROR "
        } else {
            ""
        },
        result.is_ok()
    ));
    result
}

#[cfg(test)]
#[path = "tests/coding_runtime.rs"]
mod tests;
