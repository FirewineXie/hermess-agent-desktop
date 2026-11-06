use crate::errors::DesktopFailure;
use crate::paths::{filesystem_path, plain_path};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const KEYRING_SERVICE: &str = "Hermess Agent Desktop remote gateway";

#[derive(Clone, Deserialize, Serialize)]
pub struct RemoteGatewayConfig {
    pub id: String,
    pub label: String,
    pub url: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    app.path()
        .app_config_dir()
        .map(|root| plain_path(&root).join("remote-gateway.json"))
        .map_err(|_| DesktopFailure::operation_failed())
}

pub fn read(app: &AppHandle) -> Result<Option<RemoteGatewayConfig>, DesktopFailure> {
    let path = config_path(app)?;
    let bytes = match fs::read(filesystem_path(&path)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    let config: RemoteGatewayConfig =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    if Uuid::parse_str(&config.id).is_err()
        || config.label.trim().is_empty()
        || config.url.trim().is_empty()
    {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(Some(config))
}

pub async fn save(
    app: &AppHandle,
    label: String,
    url: String,
    token: String,
) -> Result<RemoteGatewayConfig, DesktopFailure> {
    if label.trim().is_empty() || label.len() > 64 || token.is_empty() || token.len() > 16 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    crate::gateway::validate_remote_gateway_url(&url)
        .map_err(|_| DesktopFailure::invalid_input())?;
    let previous = read(app)?;
    let config = RemoteGatewayConfig {
        id: Uuid::new_v4().to_string(),
        label: label.trim().to_owned(),
        url,
    };
    let path = config_path(app)?;
    let parent = path.parent().ok_or_else(DesktopFailure::operation_failed)?;
    fs::create_dir_all(filesystem_path(parent)).map_err(|_| DesktopFailure::operation_failed())?;
    let temporary = parent.join(format!("remote-gateway-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(&config).map_err(|_| DesktopFailure::operation_failed())?;
    fs::write(filesystem_path(&temporary), bytes)
        .map_err(|_| DesktopFailure::operation_failed())?;
    let id = config.id.clone();
    let saved = tokio::task::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, &id).and_then(|entry| entry.set_password(&token))
    })
    .await;
    if !matches!(saved, Ok(Ok(()))) {
        let _ = fs::remove_file(filesystem_path(&temporary));
        return Err(DesktopFailure::operation_failed());
    }
    if replace_file(&temporary, &path).is_err() {
        let _ = fs::remove_file(filesystem_path(&temporary));
        let id = config.id.clone();
        let _ = tokio::task::spawn_blocking(move || {
            keyring::Entry::new(KEYRING_SERVICE, &id).and_then(|entry| entry.delete_credential())
        })
        .await;
        return Err(DesktopFailure::operation_failed());
    }
    if let Some(old) = previous {
        let _ = tokio::task::spawn_blocking(move || {
            keyring::Entry::new(KEYRING_SERVICE, &old.id)
                .and_then(|entry| entry.delete_credential())
        })
        .await;
    }
    Ok(config)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let wide = |path: &Path| {
        filesystem_path(path)
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let result = unsafe {
        MoveFileExW(
            wide(source).as_ptr(),
            wide(target).as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(DesktopFailure::operation_failed())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
    fs::rename(filesystem_path(source), filesystem_path(target))
        .map_err(|_| DesktopFailure::operation_failed())
}

pub async fn token(id: String) -> Result<String, DesktopFailure> {
    tokio::task::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, &id).and_then(|entry| entry.get_password())
    })
    .await
    .map_err(|_| DesktopFailure::operation_failed())?
    .map_err(|_| DesktopFailure::operation_failed())
}
