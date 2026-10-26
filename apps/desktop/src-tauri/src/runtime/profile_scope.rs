use super::{profiles, BackendState};
use crate::errors::{DesktopFailure, SESSION_OWNER_UNKNOWN, SESSION_PROFILE_MISMATCH};
use crate::gateway::GatewayClient;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub(super) struct SessionOwners(Mutex<HashMap<String, HashSet<String>>>);

impl SessionOwners {
    pub(super) fn ensure(&self, profile: &str, session_id: &str) -> Result<(), String> {
        let owners = self.0.lock().map_err(|_| "会话归属记录不可用")?;
        match owners.get(session_id) {
            Some(profiles) if profiles.contains(profile) => Ok(()),
            Some(_) => Err(SESSION_PROFILE_MISMATCH.into()),
            None => Err(SESSION_OWNER_UNKNOWN.into()),
        }
    }

    pub(super) fn record(&self, profile: &str, session_id: &str) -> Result<(), String> {
        if session_id.is_empty() {
            return Err("网关返回了空会话标识".into());
        }
        let mut owners = self.0.lock().map_err(|_| "会话归属记录不可用")?;
        owners
            .entry(session_id.to_owned())
            .or_default()
            .insert(profile.to_owned());
        Ok(())
    }
}

/// Resolves one immutable profile owner before a request crosses an async boundary.
pub(super) struct ResolvedProfileScope {
    pub(super) profile: String,
    pub(super) gateway: profiles::ProfiledGateway,
    client: Arc<GatewayClient>,
    pub(super) home: PathBuf,
    pub(super) gateway_epoch: String,
    pub(super) storage: PathBuf,
    pub(super) bundled_tools_root: Option<PathBuf>,
    port: u16,
    token: String,
    pub(super) hermes: PathBuf,
}

impl ResolvedProfileScope {
    pub(super) async fn ensure_current(&self, state: &BackendState) -> Result<(), DesktopFailure> {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        if backend.storage != self.storage
            || backend.port != self.port
            || !Arc::ptr_eq(&backend.gateway, &self.client)
            || backend.gateway.replay_epoch != self.gateway_epoch
        {
            return Err(DesktopFailure::conflict());
        }
        Ok(())
    }

    pub(super) async fn http_auth(&self) -> Result<(u16, &'static str, String), DesktopFailure> {
        if self.profile == "default" {
            return Ok((self.port, "X-Hermes-Session-Token", self.token.clone()));
        }
        let ticket = profiles::native_http_ticket(
            &self.hermes,
            &self.home,
            &self.storage.join("control").join("gateway-locks"),
            self.port,
        )
        .await?;
        Ok((self.port, "X-Hermes-Gateway-Ticket", ticket))
    }
}

pub(super) struct ProfileTopology {
    client: Arc<GatewayClient>,
    roster: Value,
    status: Value,
    session_owners: Arc<SessionOwners>,
}

impl BackendState {
    pub(super) async fn refresh_profile_topology(
        &self,
        client: Arc<GatewayClient>,
        storage: &Path,
        pid: Option<u32>,
        port: u16,
        token: &str,
    ) -> Result<(Value, Value), DesktopFailure> {
        // Serialize explicit refreshes with cache misses so an older response
        // cannot replace a newer topology for the same Gateway connection.
        let mut cache = self.2.lock().await;
        let roster = client
            .request("profiles.list", json!({"include_sessions": false}))
            .await?;
        let status = profiles::root_status(storage, pid, port, token).await?;
        let session_owners = cache
            .as_ref()
            .filter(|entry| Arc::ptr_eq(&entry.client, &client))
            .map(|entry| Arc::clone(&entry.session_owners))
            .unwrap_or_default();
        *cache = Some(ProfileTopology {
            client,
            roster: roster.clone(),
            status: status.clone(),
            session_owners,
        });
        Ok((roster, status))
    }

    pub(super) async fn resolve_profile(
        &self,
        profile: &str,
    ) -> Result<ResolvedProfileScope, DesktopFailure> {
        if !valid_profile_name(profile) {
            return Err(DesktopFailure::invalid_input());
        }
        let (client, storage, pid, port, token) = {
            let owned = self.0.lock().await;
            let backend = owned
                .as_ref()
                .ok_or_else(DesktopFailure::runtime_unavailable)?;
            (
                Arc::clone(&backend.gateway),
                backend.storage.clone(),
                backend.child.id(),
                backend.port,
                backend.token.clone(),
            )
        };
        let (roster, status, session_owners) = {
            let mut cache = self.2.lock().await;
            if let Some(topology) = cache
                .as_ref()
                .filter(|entry| Arc::ptr_eq(&entry.client, &client))
            {
                (
                    topology.roster.clone(),
                    topology.status.clone(),
                    Arc::clone(&topology.session_owners),
                )
            } else {
                let roster = client
                    .request("profiles.list", json!({"include_sessions": false}))
                    .await?;
                let status = profiles::root_status(&storage, pid, port, &token).await?;
                let session_owners = Arc::default();
                *cache = Some(ProfileTopology {
                    client: Arc::clone(&client),
                    roster: roster.clone(),
                    status: status.clone(),
                    session_owners: Arc::clone(&session_owners),
                });
                (roster, status, session_owners)
            }
        };
        if !profiles::roster_contains(&roster, profile) {
            return Err(DesktopFailure::invalid_input());
        }
        if !profiles::is_served(&status, profile) {
            return Err(DesktopFailure::conflict());
        }
        // A restart during validation must never turn the result into a new owner's handle.
        let owned = self.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        if backend.storage != storage || !Arc::ptr_eq(&backend.gateway, &client) {
            return Err(DesktopFailure::conflict());
        }
        let root = storage.join("hermes-home");
        let home = if profile == "default" {
            root
        } else {
            root.join("profiles").join(profile)
        };
        Ok(ResolvedProfileScope {
            profile: profile.to_owned(),
            gateway: profiles::ProfiledGateway::new(
                Arc::clone(&client),
                profile.to_owned(),
                session_owners,
            ),
            client,
            home,
            gateway_epoch: backend.gateway.replay_epoch.clone(),
            storage: backend.storage.clone(),
            bundled_tools_root: backend.bundled_tools_root.clone(),
            port: backend.port,
            token: backend.token.clone(),
            hermes: backend.hermes.clone(),
        })
    }
}

fn valid_profile_name(profile: &str) -> bool {
    !profile.is_empty()
        && profile.len() <= 64
        && profile.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
}

#[cfg(test)]
#[path = "tests/profile_scope.rs"]
mod tests;
