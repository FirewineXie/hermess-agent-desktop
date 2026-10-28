use super::{
    profile_scope::{valid_profile_name, SessionOwners},
    remote_connections, remote_secret, remote_ssh, BackendInfo, BackendState,
};
use crate::errors::DesktopFailure;
use crate::gateway::GatewayClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
pub struct RemoteRegistryState(Mutex<()>);

pub(super) struct ActiveRemote {
    pub(super) connection_id: String,
    pub(super) label: String,
    pub(super) base_url: String,
    pub(super) token: String,
    pub(super) gateway: Arc<GatewayClient>,
    pub(super) roster: Value,
    pub(super) selected_profile: String,
    pub(super) session_owners: Arc<SessionOwners>,
    pub(super) _ssh_tunnel: Option<remote_ssh::SshTunnel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedRemoteConnection {
    connection_id: String,
    label: String,
    replay_epoch: String,
    profiles: Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRemoteConnection {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub base_url: String,
    pub auth_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_target: Option<remote_ssh::SshTarget>,
}

#[derive(Deserialize, Serialize)]
struct RegistryFile {
    schema: u32,
    connections: Vec<SavedRemoteConnection>,
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("remote-connections.json"))
        .map_err(|_| DesktopFailure::operation_failed())
}

fn read_registry(path: &Path) -> Result<Vec<SavedRemoteConnection>, DesktopFailure> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|_| DesktopFailure::operation_failed())?;
    if bytes.len() > 128 * 1024 {
        return Err(DesktopFailure::operation_failed());
    }
    let file: RegistryFile =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    let mut seen_ids = HashSet::new();
    let mut seen_urls = HashSet::new();
    if file.schema != 1
        || file.connections.len() > 32
        || file.connections.iter().any(|entry| {
            Uuid::parse_str(&entry.id).is_err()
                || !seen_ids.insert(&entry.id)
                || !seen_urls.insert(&entry.base_url)
                || entry.label.trim().is_empty()
                || entry.label.chars().count() > 100
                || entry.label.chars().any(char::is_control)
                || entry.auth_mode != "token"
                || match entry.kind.as_str() {
                    "url" => {
                        entry.ssh_target.is_some()
                            || remote_connections::normalized_remote_url(&entry.base_url)
                                .map(|url| url.as_str().trim_end_matches('/') != entry.base_url)
                                .unwrap_or(true)
                    }
                    "ssh" => entry.ssh_target.as_ref().is_none_or(|target| {
                        remote_ssh::target_label(target)
                            .map(|label| label != entry.base_url)
                            .unwrap_or(true)
                    }),
                    _ => true,
                }
        })
    {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(file.connections)
}

fn write_registry(
    path: &Path,
    connections: &[SavedRemoteConnection],
) -> Result<(), DesktopFailure> {
    let parent = path.parent().ok_or_else(DesktopFailure::operation_failed)?;
    fs::create_dir_all(parent).map_err(|_| DesktopFailure::operation_failed())?;
    let bytes = serde_json::to_vec(&RegistryFile {
        schema: 1,
        connections: connections.to_vec(),
    })
    .map_err(|_| DesktopFailure::operation_failed())?;
    let temporary = parent.join(format!("remote-connections-{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes).map_err(|_| DesktopFailure::operation_failed())?;
    if fs::rename(&temporary, path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(DesktopFailure::operation_failed());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_remote_connections(
    app: AppHandle,
    registry: State<'_, RemoteRegistryState>,
) -> Result<Vec<SavedRemoteConnection>, DesktopFailure> {
    let _guard = registry.0.lock().await;
    read_registry(&registry_path(&app)?)
}

#[tauri::command]
pub async fn save_remote_url_connection(
    app: AppHandle,
    registry: State<'_, RemoteRegistryState>,
    label: String,
    raw_url: String,
    token: String,
) -> Result<SavedRemoteConnection, DesktopFailure> {
    let label = label.trim();
    if label.is_empty()
        || label.chars().count() > 100
        || label.chars().any(char::is_control)
        || token.is_empty()
        || token.len() > 2048
        || !token.is_ascii()
        || token.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let base = remote_connections::normalized_remote_url(&raw_url)?;
    let base_url = base.as_str().trim_end_matches('/').to_owned();
    let _guard = registry.0.lock().await;
    let path = registry_path(&app)?;
    let mut entries = read_registry(&path)?;
    if entries.len() >= 32 || entries.iter().any(|entry| entry.base_url == base_url) {
        return Err(DesktopFailure::conflict());
    }
    let probe =
        remote_connections::test_remote_url_connection(base_url.clone(), token.clone()).await?;
    if probe.status != "ready" {
        return Err(DesktopFailure::conflict());
    }
    let entry = SavedRemoteConnection {
        id: Uuid::new_v4().to_string(),
        label: label.to_owned(),
        kind: "url".into(),
        base_url,
        auth_mode: "token".into(),
        ssh_target: None,
    };
    remote_secret::store(&entry.id, &entry.base_url, &token)?;
    entries.push(entry.clone());
    if let Err(error) = write_registry(&path, &entries) {
        let _ = remote_secret::remove(&entry.id, &entry.base_url);
        return Err(error);
    }
    Ok(entry)
}

#[tauri::command]
pub async fn save_remote_ssh_connection(
    app: AppHandle,
    registry: State<'_, RemoteRegistryState>,
    label: String,
    target: remote_ssh::SshTarget,
    token: String,
) -> Result<SavedRemoteConnection, DesktopFailure> {
    let label = label.trim();
    if label.is_empty()
        || label.chars().count() > 100
        || label.chars().any(char::is_control)
        || token.is_empty()
        || token.len() > 2048
        || !token.is_ascii()
        || token.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let base_url = remote_ssh::target_label(&target)?;
    let _guard = registry.0.lock().await;
    let path = registry_path(&app)?;
    let mut entries = read_registry(&path)?;
    if entries.len() >= 32 || entries.iter().any(|entry| entry.base_url == base_url) {
        return Err(DesktopFailure::conflict());
    }
    remote_ssh::ensure_reachable(&target).await?;
    let (tunnel_url, _tunnel) = remote_ssh::start_tunnel(&target).await?;
    let probe = remote_connections::test_remote_url_connection(tunnel_url, token.clone()).await?;
    if probe.status != "ready" {
        return Err(DesktopFailure::connection_lost());
    }
    let entry = SavedRemoteConnection {
        id: Uuid::new_v4().to_string(),
        label: label.to_owned(),
        kind: "ssh".into(),
        base_url,
        auth_mode: "token".into(),
        ssh_target: Some(target),
    };
    remote_secret::store(&entry.id, &entry.base_url, &token)?;
    entries.push(entry.clone());
    if let Err(error) = write_registry(&path, &entries) {
        let _ = remote_secret::remove(&entry.id, &entry.base_url);
        return Err(error);
    }
    Ok(entry)
}

#[tauri::command]
pub async fn delete_remote_connection(
    app: AppHandle,
    registry: State<'_, RemoteRegistryState>,
    backend: State<'_, BackendState>,
    id: String,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&id).map_err(|_| DesktopFailure::invalid_input())?;
    let _guard = registry.0.lock().await;
    let path = registry_path(&app)?;
    let mut entries = read_registry(&path)?;
    let index = entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or_else(DesktopFailure::invalid_input)?;
    let removed = entries.remove(index);
    if backend
        .3
        .lock()
        .await
        .as_ref()
        .is_some_and(|active| active.connection_id == id)
    {
        return Err(DesktopFailure::conflict());
    }
    let old_token = remote_secret::load(&removed.id, &removed.base_url)?;
    remote_secret::remove(&removed.id, &removed.base_url)?;
    if let Err(error) = write_registry(&path, &entries) {
        if let Some(token) = old_token {
            let _ = remote_secret::store(&removed.id, &removed.base_url, &token);
        }
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn apply_saved_remote_connection(
    app: AppHandle,
    registry: State<'_, RemoteRegistryState>,
    backend: State<'_, BackendState>,
    id: String,
) -> Result<AppliedRemoteConnection, DesktopFailure> {
    Uuid::parse_str(&id).map_err(|_| DesktopFailure::invalid_input())?;
    // Serialize application with deletion and metadata replacement. A failed probe or
    // handshake leaves the currently active connection untouched.
    let _guard = registry.0.lock().await;
    let entry = read_registry(&registry_path(&app)?)?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(DesktopFailure::invalid_input)?;
    let token = remote_secret::load(&entry.id, &entry.base_url)?
        .ok_or_else(DesktopFailure::connection_lost)?;
    let (connect_url, ssh_tunnel) = if entry.kind == "ssh" {
        let target = entry
            .ssh_target
            .as_ref()
            .ok_or_else(DesktopFailure::invalid_input)?;
        remote_ssh::ensure_reachable(target).await?;
        let (url, tunnel) = remote_ssh::start_tunnel(target).await?;
        (url, Some(tunnel))
    } else {
        (entry.base_url.clone(), None)
    };
    let probe =
        remote_connections::test_remote_url_connection(connect_url.clone(), token.clone()).await?;
    if probe.status != "ready" {
        return Err(DesktopFailure::connection_lost());
    }
    let base = remote_connections::normalized_remote_url(&connect_url)?;
    let ws_url = remote_connections::remote_websocket_url(&base, &token)?;
    let gateway = Arc::new(
        GatewayClient::connect_remote(ws_url.as_str(), &entry.id, app)
            .await
            .map_err(|_| DesktopFailure::connection_lost())?,
    );
    let roster = match gateway
        .request("profiles.list", json!({"include_sessions": false}))
        .await
    {
        Ok(value)
            if value
                .get("profiles")
                .and_then(Value::as_array)
                .is_some_and(|rows| {
                    !rows.is_empty()
                        && rows.len() <= 64
                        && rows.iter().all(|row| {
                            row.get("name")
                                .and_then(Value::as_str)
                                .is_some_and(valid_profile_name)
                        })
                }) =>
        {
            value
        }
        _ => {
            gateway.close();
            return Err(DesktopFailure::connection_lost());
        }
    };
    if gateway.replay_epoch.is_empty() {
        gateway.close();
        return Err(DesktopFailure::connection_lost());
    }
    let selected_profile = roster["profiles"][0]["name"]
        .as_str()
        .ok_or_else(DesktopFailure::operation_failed)?
        .to_owned();
    let info = AppliedRemoteConnection {
        connection_id: entry.id.clone(),
        label: entry.label.clone(),
        replay_epoch: gateway.replay_epoch.clone(),
        profiles: roster.get("profiles").cloned().unwrap_or_else(|| json!([])),
    };
    let old = backend.3.lock().await.replace(ActiveRemote {
        connection_id: entry.id,
        label: entry.label,
        base_url: entry.base_url,
        token,
        gateway,
        roster,
        selected_profile,
        session_owners: Arc::default(),
        _ssh_tunnel: ssh_tunnel,
    });
    if let Some(old) = old {
        old.gateway.close();
    }
    Ok(info)
}

#[tauri::command]
pub async fn current_remote_connection(
    backend: State<'_, BackendState>,
) -> Result<Option<AppliedRemoteConnection>, DesktopFailure> {
    let active = backend.3.lock().await;
    Ok(active.as_ref().map(|current| AppliedRemoteConnection {
        connection_id: current.connection_id.clone(),
        label: current.label.clone(),
        replay_epoch: current.gateway.replay_epoch.clone(),
        profiles: current
            .roster
            .get("profiles")
            .cloned()
            .unwrap_or_else(|| json!([])),
    }))
}

#[tauri::command]
pub async fn return_to_local_connection(
    registry: State<'_, RemoteRegistryState>,
    backend: State<'_, BackendState>,
) -> Result<Option<BackendInfo>, DesktopFailure> {
    let _guard = registry.0.lock().await;
    let mut local = backend.0.lock().await;
    let info = if let Some(owned) = local.as_mut() {
        if owned
            .child
            .try_wait()
            .map_err(|_| DesktopFailure::operation_failed())?
            .is_none()
            && !owned.gateway.is_closed()
        {
            Some(BackendInfo {
                port: owned.port,
                pid: owned
                    .child
                    .id()
                    .ok_or_else(DesktopFailure::runtime_unavailable)?,
                replay_epoch: owned.gateway.replay_epoch.clone(),
                connection_id: "local",
            })
        } else {
            None
        }
    } else {
        None
    };
    drop(local);
    if let Some(remote) = backend.3.lock().await.take() {
        remote.gateway.close();
    }
    Ok(info)
}

#[cfg(test)]
#[path = "tests/remote_registry.rs"]
mod tests;
