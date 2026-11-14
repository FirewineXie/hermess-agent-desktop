use super::{
    chat::merge_session_lists,
    profile_scope::valid_profile_name,
    profiles::ProfiledGateway,
    remote_config::{self, RemoteGatewayConfig},
    remote_gateway::{connect_saved, ActiveRemote},
    BackendState,
};
use crate::{errors::DesktopFailure, gateway::GatewayClient};
use futures_util::{stream, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};

async fn warm(
    app: &AppHandle,
    state: &BackendState,
    config: &RemoteGatewayConfig,
) -> Result<ActiveRemote, DesktopFailure> {
    // Serialize with activation and registry writes so a removed endpoint
    // cannot reappear and each id owns at most one connected standby client.
    let mut standby = state.7.lock().await;
    if let Some(active) = state
        .5
        .lock()
        .await
        .as_ref()
        .filter(|row| row.config.id == config.id)
    {
        return Ok(active.clone());
    }
    if let Some(ready) = standby
        .get(&config.id)
        .filter(|row| row.gateway.is_connected())
    {
        return Ok(ready.clone());
    }
    let connected = connect_saved(app, config.clone()).await?;
    if !remote_config::read(app)?
        .iter()
        .any(|row| row.id == config.id)
    {
        return Err(DesktopFailure::conflict());
    }
    standby.insert(config.id.clone(), connected.clone());
    Ok(connected)
}

async fn profiles(gateway: &GatewayClient) -> Result<Vec<String>, DesktopFailure> {
    let result = gateway
        .request("profiles.list", json!({"include_sessions":false}))
        .await?;
    let profiles = result["profiles"]
        .as_array()
        .ok_or_else(DesktopFailure::operation_failed)?;
    Ok(profiles
        .iter()
        .filter_map(|row| row["name"].as_str())
        .filter(|name| valid_profile_name(name))
        .map(str::to_owned)
        .collect())
}

async fn session_rows(gateway: ProfiledGateway) -> Result<Value, DesktopFailure> {
    let live = gateway.request("session.list", json!({"limit":12})).await?;
    let stored = gateway
        .request("session.list", json!({"limit":12,"scope":"stored"}))
        .await?;
    Ok(merge_session_lists(&live, &stored)["sessions"].clone())
}

async fn remote_rows(
    app: &AppHandle,
    state: &BackendState,
    config: &RemoteGatewayConfig,
) -> Result<Vec<Value>, DesktopFailure> {
    let remote = warm(app, state, config).await?;
    let profiles = profiles(&remote.gateway).await?;
    let rows = stream::iter(profiles)
        .map(|profile| {
            let gateway = ProfiledGateway::new(
                Arc::clone(&remote.gateway),
                profile.clone(),
                Arc::clone(&remote.session_owners),
            );
            async move {
                Ok::<_, DesktopFailure>(
                    json!({"profile":profile, "sessions":session_rows(gateway).await?}),
                )
            }
        })
        .buffered(4)
        .collect::<Vec<_>>()
        .await;
    rows.into_iter().collect()
}

async fn local_rows(state: &BackendState) -> Result<Vec<Value>, DesktopFailure> {
    let gateway = state
        .0
        .lock()
        .await
        .as_ref()
        .map(|owned| Arc::clone(&owned.gateway))
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    let mut rows = Vec::new();
    for profile in profiles(&gateway).await? {
        if let Ok(scope) = state.resolve_profile(&profile).await {
            rows.push(json!({"profile":profile,"sessions":session_rows(scope.gateway).await?}));
        }
    }
    Ok(rows)
}

fn host(id: Option<&str>, label: Option<&str>, rows: Result<Vec<Value>, DesktopFailure>) -> Value {
    json!({"id":id,"label":label,"connected":rows.is_ok(),"profiles":rows.unwrap_or_default()})
}

#[tauri::command]
pub async fn gateway_sidebar_sessions(
    app: AppHandle,
    state: State<'_, BackendState>,
) -> Result<Vec<Value>, DesktopFailure> {
    let active_id = state
        .5
        .lock()
        .await
        .as_ref()
        .map(|active| active.config.id.clone());
    let mut hosts = Vec::new();
    if active_id.is_some() {
        hosts.push(host(None, None, local_rows(&state).await));
    }
    for config in remote_config::read(&app)? {
        if active_id.as_deref() != Some(&config.id) {
            hosts.push(host(
                Some(&config.id),
                Some(&config.label),
                remote_rows(&app, &state, &config).await,
            ));
        }
    }
    Ok(hosts)
}
