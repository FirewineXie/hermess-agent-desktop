use super::{
    profile_scope::SessionOwners,
    remote_config::{self, RemoteGatewayConfig},
    BackendState,
};
use crate::{errors::DesktopFailure, gateway::GatewayClient};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

pub struct ActiveRemote {
    pub(super) config: RemoteGatewayConfig,
    pub(super) gateway: Arc<GatewayClient>,
    pub(super) selected_profile: String,
    pub(super) session_owners: Arc<SessionOwners>,
    pub(super) storage: PathBuf,
}

impl Drop for ActiveRemote {
    fn drop(&mut self) {
        self.gateway.close();
    }
}

#[derive(Serialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ActiveGateway {
    Local,
    Remote {
        config: RemoteGatewayConfig,
        replay_epoch: String,
        selected_profile: String,
    },
}

#[derive(Serialize)]
pub struct RemoteGatewayProbe {
    pub profiles: Vec<String>,
}

pub(super) async fn list_remote_profiles(
    state: &BackendState,
) -> Result<Option<Value>, DesktopFailure> {
    let remote = state.5.lock().await;
    let Some(active) = remote.as_ref() else {
        return Ok(None);
    };
    let roster = active
        .gateway
        .request("profiles.list", json!({"include_sessions":false}))
        .await?;
    let profiles = roster.get("profiles").cloned().unwrap_or_else(|| json!([]));
    let served = profiles
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| row["name"].as_str())
        .collect::<Vec<_>>();
    Ok(Some(
        json!({"profiles":profiles,"selected":active.selected_profile,
        "gateway_mode":"remote","gateways":[{"profile":"default","served_profiles":served}],"reason":null}),
    ))
}

pub(super) async fn activate_remote_profile(
    state: &BackendState,
    name: &str,
) -> Result<bool, DesktopFailure> {
    let mut remote = state.5.lock().await;
    let Some(active) = remote.as_mut() else {
        return Ok(false);
    };
    let roster = active
        .gateway
        .request("profiles.list", json!({"include_sessions":false}))
        .await?;
    if !super::profiles::roster_contains(&roster, name) {
        return Err(DesktopFailure::invalid_input());
    }
    active.selected_profile = name.to_owned();
    Ok(true)
}

async fn probe(
    app: &AppHandle,
    url: &str,
    token: &str,
) -> Result<RemoteGatewayProbe, DesktopFailure> {
    let gateway = GatewayClient::connect_remote(url, token, app.clone(), false)
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    let result = async {
        let roster = gateway
            .request("profiles.list", json!({"include_sessions": false}))
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        let profiles = roster["profiles"]
            .as_array()
            .ok_or_else(DesktopFailure::operation_failed)?
            .iter()
            .filter_map(|row| row["name"].as_str().map(str::to_owned))
            .collect();
        Ok(RemoteGatewayProbe { profiles })
    }
    .await;
    gateway.close();
    result
}

#[tauri::command]
pub async fn active_gateway(
    state: State<'_, BackendState>,
) -> Result<ActiveGateway, DesktopFailure> {
    let active = state.5.lock().await;
    Ok(match active.as_ref() {
        Some(remote) => ActiveGateway::Remote {
            config: remote.config.clone(),
            replay_epoch: remote.gateway.replay_epoch.clone(),
            selected_profile: remote.selected_profile.clone(),
        },
        None => ActiveGateway::Local,
    })
}

#[tauri::command]
pub async fn activate_saved_remote_gateway(
    app: AppHandle,
    state: State<'_, BackendState>,
) -> Result<ActiveGateway, DesktopFailure> {
    let config = remote_config::read(&app)?.ok_or_else(DesktopFailure::invalid_input)?;
    let token = remote_config::token(config.id.clone()).await?;
    let operation = Uuid::new_v4();
    log(
        &app,
        &format!(
            "remote_gateway_activate_start operation={operation} id={}",
            config.id
        ),
    );
    let result = async {
        let storage = app
            .path()
            .app_data_dir()
            .map_err(|_| DesktopFailure::operation_failed())?;
        std::fs::create_dir_all(crate::paths::filesystem_path(&storage))
            .map_err(|_| DesktopFailure::operation_failed())?;
        let gateway = Arc::new(
            GatewayClient::connect_remote(&config.url, &token, app.clone(), false)
                .await
                .map_err(|_| DesktopFailure::connection_lost())?,
        );
        let roster = gateway
            .request("profiles.list", json!({"include_sessions":false}))
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        let selected_profile = roster["profiles"]
            .as_array()
            .and_then(|rows| rows.iter().find_map(|row| row["name"].as_str()))
            .ok_or_else(DesktopFailure::operation_failed)?
            .to_owned();
        if let Err(_) = gateway.enable_remote_events().await {
            gateway.close();
            return Err(DesktopFailure::connection_lost());
        }
        let mut active = state.5.lock().await;
        let local = state.0.lock().await;
        if let Some(backend) = local.as_ref() {
            backend.gateway.disable_events();
        }
        *active = Some(ActiveRemote {
            config: config.clone(),
            gateway: Arc::clone(&gateway),
            selected_profile: selected_profile.clone(),
            session_owners: Arc::default(),
            storage,
        });
        Ok(ActiveGateway::Remote {
            config,
            replay_epoch: gateway.replay_epoch.clone(),
            selected_profile,
        })
    }
    .await;
    log(
        &app,
        &format!(
            "remote_gateway_activate_{} operation={operation}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    result
}

#[tauri::command]
pub async fn activate_local_gateway(
    app: AppHandle,
    state: State<'_, BackendState>,
) -> Result<ActiveGateway, DesktopFailure> {
    let operation = Uuid::new_v4();
    log(
        &app,
        &format!("remote_gateway_deactivate_start operation={operation}"),
    );
    let mut active = state.5.lock().await;
    let local = state.0.lock().await;
    if let Some(backend) = local.as_ref() {
        if backend.gateway.enable_local_events().await.is_err() {
            log(
                &app,
                &format!("remote_gateway_deactivate_failed operation={operation}"),
            );
            return Err(DesktopFailure::connection_lost());
        }
    }
    *active = None;
    log(
        &app,
        &format!("remote_gateway_deactivate_completed operation={operation}"),
    );
    Ok(ActiveGateway::Local)
}

fn log(app: &AppHandle, event: &str) {
    if let Ok(storage) = app.path().app_data_dir() {
        let _ = crate::diagnostics::append_client_event(&storage, event);
    }
}

#[tauri::command]
pub async fn test_remote_gateway(
    app: AppHandle,
    url: String,
    token: String,
) -> Result<RemoteGatewayProbe, DesktopFailure> {
    let operation = Uuid::new_v4();
    log(
        &app,
        &format!("remote_gateway_test_start operation={operation}"),
    );
    let result = async {
        crate::gateway::validate_remote_gateway_url(&url)
            .map_err(|_| DesktopFailure::invalid_input())?;
        if token.is_empty() || token.len() > 16 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        probe(&app, &url, &token).await
    }
    .await;
    log(
        &app,
        &format!(
            "remote_gateway_test_{} operation={operation}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    result
}

#[tauri::command]
pub fn saved_remote_gateway(app: AppHandle) -> Result<Option<RemoteGatewayConfig>, DesktopFailure> {
    remote_config::read(&app)
}

#[tauri::command]
pub async fn save_remote_gateway(
    app: AppHandle,
    label: String,
    url: String,
    token: String,
) -> Result<RemoteGatewayConfig, DesktopFailure> {
    let operation = Uuid::new_v4();
    log(
        &app,
        &format!("remote_gateway_save_start operation={operation}"),
    );
    let result = async {
        probe(&app, &url, &token).await?;
        remote_config::save(&app, label, url, token).await
    }
    .await;
    log(
        &app,
        &format!(
            "remote_gateway_save_{} operation={operation}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    result
}
