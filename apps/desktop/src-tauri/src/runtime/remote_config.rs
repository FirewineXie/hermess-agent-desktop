use crate::errors::DesktopFailure;
use crate::paths::{filesystem_path, plain_path};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
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
    #[serde(default, rename = "sshTarget", skip_serializing_if = "Option::is_none")]
    pub ssh_target: Option<String>,
}

pub(super) fn valid_ssh_target(value: &str) -> bool {
    let mut pieces = value.split('@');
    let valid = |part: &str| {
        !part.starts_with('-')
            && !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    value.len() <= 253
        && pieces.next().is_some_and(valid)
        && pieces.next().is_none_or(valid)
        && pieces.next().is_none()
}

fn config_path(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    app.path()
        .app_config_dir()
        .map(|root| plain_path(&root).join("remote-gateway.json"))
        .map_err(|_| DesktopFailure::operation_failed())
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SavedGateways {
    List(Vec<RemoteGatewayConfig>),
    Legacy(RemoteGatewayConfig),
}

pub fn read(app: &AppHandle) -> Result<Vec<RemoteGatewayConfig>, DesktopFailure> {
    let path = config_path(app)?;
    let bytes = match fs::read(filesystem_path(&path)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    let saved: SavedGateways =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    let configs = match saved {
        SavedGateways::List(configs) => configs,
        SavedGateways::Legacy(config) => vec![config],
    };
    let mut ids = HashSet::new();
    if configs.iter().any(|config| {
        Uuid::parse_str(&config.id).is_err()
            || !ids.insert(config.id.as_str())
            || config.label.trim().is_empty()
            || config.url.trim().is_empty()
    }) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(configs)
}

fn prepare_write(path: &Path, configs: &[RemoteGatewayConfig]) -> Result<PathBuf, DesktopFailure> {
    let parent = path.parent().ok_or_else(DesktopFailure::operation_failed)?;
    fs::create_dir_all(filesystem_path(parent)).map_err(|_| DesktopFailure::operation_failed())?;
    let temporary = parent.join(format!("remote-gateway-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(configs).map_err(|_| DesktopFailure::operation_failed())?;
    if fs::write(filesystem_path(&temporary), bytes).is_err() {
        let _ = fs::remove_file(filesystem_path(&temporary));
        return Err(DesktopFailure::operation_failed());
    }
    Ok(temporary)
}

pub async fn save(
    app: &AppHandle,
    label: String,
    url: String,
    token: String,
    ssh_target: Option<String>,
) -> Result<RemoteGatewayConfig, DesktopFailure> {
    if label.trim().is_empty() || label.len() > 64 || token.is_empty() || token.len() > 16 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    crate::gateway::validate_remote_gateway_url(&url)
        .map_err(|_| DesktopFailure::invalid_input())?;
    let ssh_target = ssh_target
        .map(|target| target.trim().to_owned())
        .filter(|target| !target.is_empty());
    if ssh_target
        .as_deref()
        .is_some_and(|target| !valid_ssh_target(target))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut configs = read(app)?;
    let url = url.trim_end_matches('/').to_owned();
    let previous = configs
        .iter()
        .position(|entry| entry.url.trim_end_matches('/') == url)
        .map(|index| configs.remove(index));
    let config = RemoteGatewayConfig {
        id: Uuid::new_v4().to_string(),
        label: label.trim().to_owned(),
        url,
        ssh_target,
    };
    let path = config_path(app)?;
    configs.push(config.clone());
    let temporary = prepare_write(&path, &configs)?;
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
pub(super) fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
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
pub(super) fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
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

pub async fn delete(app: &AppHandle, id: &str, operation: Uuid) -> Result<(), DesktopFailure> {
    Uuid::parse_str(id).map_err(|_| DesktopFailure::invalid_input())?;
    let mut configs = read(app)?;
    if configs.is_empty() {
        return Ok(());
    }
    let Some(index) = configs.iter().position(|config| config.id == id) else {
        return Err(DesktopFailure::conflict());
    };
    let config = configs.remove(index);
    let path = config_path(app)?;
    let temporary = prepare_write(&path, &configs)?;
    let credential = tokio::task::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, &config.id).and_then(|entry| entry.delete_credential())
    })
    .await;
    if !matches!(credential, Ok(Ok(())) | Ok(Err(keyring::Error::NoEntry))) {
        let _ = fs::remove_file(filesystem_path(&temporary));
        return Err(delete_failure(app, operation, "credential"));
    }
    // Keep the configuration until credential cleanup succeeds so a failed
    // deletion can still be retried using the same credential identifier.
    if replace_file(&temporary, &path).is_err() {
        let _ = fs::remove_file(filesystem_path(&temporary));
        return Err(delete_failure(app, operation, "config"));
    }
    Ok(())
}

fn delete_failure(app: &AppHandle, operation: Uuid, step: &str) -> DesktopFailure {
    if let Ok(storage) = app.path().app_data_dir() {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            &format!("ERROR remote_gateway_delete_failed operation={operation} step={step}"),
        );
    }
    DesktopFailure::operation_failed()
}

#[cfg(all(test, windows))]
#[path = "tests/remote_config.rs"]
pub(super) mod tests;
