use super::{
    config, helper_python,
    profile_scope::{valid_profile_name, SessionOwners},
    remote_connections, BackendState,
};
use crate::errors::{DesktopFailure, SESSION_PROFILE_MISMATCH};
use crate::gateway::GatewayClient;
use crate::process_manager;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path, sync::Arc, time::Duration};
use tauri::State;
use tokio::time::timeout;

const SELECTED_FILE: &str = "selected-profile";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePresetSelection {
    personality_name: String,
    personality_prompt: String,
    skills: Vec<String>,
    mcp: Vec<String>,
}

/// A request keeps the profile selected when it began, even if the UI switches meanwhile.
pub(super) struct ProfiledGateway {
    client: Arc<GatewayClient>,
    profile: String,
    session_owners: Arc<SessionOwners>,
}

impl ProfiledGateway {
    pub(super) fn new(
        client: Arc<GatewayClient>,
        profile: String,
        session_owners: Arc<SessionOwners>,
    ) -> Self {
        Self {
            client,
            profile,
            session_owners,
        }
    }

    pub(super) async fn request(
        &self,
        method: &'static str,
        params: Value,
    ) -> Result<Value, String> {
        let requested_session = params
            .get("session_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        if !matches!(method, "session.create" | "session.list" | "session.resume") {
            if let Some(session_id) = requested_session.as_deref() {
                self.session_owners.ensure(&self.profile, session_id)?;
            }
        }
        let params = scoped_params(&self.profile, method, params)?;
        let result = self.client.request(method, params).await?;
        match method {
            "session.create" => {
                for key in ["session_id", "stored_session_id"] {
                    if let Some(id) = result.get(key).and_then(Value::as_str) {
                        self.session_owners.record(&self.profile, id)?;
                    }
                }
            }
            "session.list" => {
                for row in result
                    .get("sessions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    for key in ["id", "session_id", "resolved_id"] {
                        if let Some(id) = row.get(key).and_then(Value::as_str) {
                            self.session_owners.record(&self.profile, id)?;
                        }
                    }
                }
            }
            "session.resume" => {
                if let Some(id) = requested_session.as_deref() {
                    self.session_owners.record(&self.profile, id)?;
                }
                if let Some(id) = result.get("session_id").and_then(Value::as_str) {
                    self.session_owners.record(&self.profile, id)?;
                }
            }
            _ => {}
        }
        Ok(result)
    }

    pub(super) async fn answer(
        &self,
        id: String,
        method: String,
        result: Value,
        session_id: String,
    ) -> Result<(), String> {
        self.session_owners.ensure(&self.profile, &session_id)?;
        self.client
            .answer(id, method, result, session_id, self.profile.clone())
            .await
    }
}

fn scoped_params(profile: &str, method: &str, mut params: Value) -> Result<Value, String> {
    let map = params.as_object_mut().ok_or("网关请求参数无效")?;
    if map
        .get("profile")
        .is_some_and(|value| value.as_str() != Some(profile))
    {
        return Err(SESSION_PROFILE_MISMATCH.into());
    }
    if profile != "default" {
        // Unknown methods must not silently execute against the launch Profile.
        if !accepts_profile(method) {
            return Err(format!("网关方法 {method} 尚未验证命名 Profile 路由"));
        }
        map.insert("profile".into(), json!(profile));
    } else {
        map.remove("profile");
    }
    Ok(params)
}

fn accepts_profile(method: &str) -> bool {
    matches!(
        method,
        "session.create"
            | "session.list"
            | "session.resume"
            | "session.interrupt"
            | "session.stats"
            | "session.mutate"
            | "session.events.since"
            | "prompt.submit"
            | "commands.catalog"
            | "slash.exec"
            | "command.dispatch"
            | "image.attach"
            | "image.attach_bytes"
            | "image.detach"
            | "file.attach"
            | "config.get"
            | "config.set"
            | "model.options"
            | "browser.manage"
            | "cron.manage"
            | "setup.runtime_check"
            | "shared_metrics.status"
            | "shared_metrics.set"
    )
}

pub(super) fn roster_contains(roster: &Value, name: &str) -> bool {
    roster
        .get("profiles")
        .and_then(Value::as_array)
        .is_some_and(|rows| {
            rows.iter()
                .any(|row| row.get("name").and_then(Value::as_str) == Some(name))
        })
}

pub(super) async fn restore_selected_profile(
    storage: &Path,
    gateway: &GatewayClient,
    pid: Option<u32>,
    port: u16,
    token: &str,
) -> String {
    let saved = fs::read_to_string(storage.join("control").join(SELECTED_FILE)).unwrap_or_default();
    let name = saved.trim();
    if name.is_empty() || name == "default" {
        return "default".into();
    }
    match gateway
        .request("profiles.list", json!({"include_sessions": false}))
        .await
    {
        Ok(roster)
            if roster_contains(&roster, name)
                && root_status(storage, pid, port, token)
                    .await
                    .ok()
                    .is_some_and(|status| is_served(&status, name)) =>
        {
            name.to_owned()
        }
        _ => "default".into(),
    }
}

pub(super) async fn root_status(
    storage: &Path,
    pid: Option<u32>,
    port: u16,
    token: &str,
) -> Result<Value, DesktopFailure> {
    let response = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?
        .get(format!("http://127.0.0.1:{port}/api/status"))
        .header("X-Hermes-Session-Token", token)
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let mut status: Value = response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    // /api/status caches topology briefly. This product owns the child PID, so its runtime
    // record gives a fresher served set after a profile is hot-added without restarting it.
    if let Some(served) = live_served_profiles(storage, pid) {
        status["gateway_mode"] = json!(if served.len() > 1 {
            "multiplex"
        } else {
            "single"
        });
        status["gateways"] = json!([{"profile": "default", "served_profiles": served}]);
    }
    Ok(status)
}

fn live_served_profiles(storage: &Path, pid: Option<u32>) -> Option<Vec<String>> {
    let path = storage.join("hermes-home").join("gateway_state.json");
    if fs::metadata(&path).ok()?.len() > 1024 * 1024 {
        return None;
    }
    let status: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if status.get("pid")?.as_u64()? != u64::from(pid?)
        || status.get("gateway_state")?.as_str()? != "running"
    {
        return None;
    }
    Some(
        status
            .get("served_profiles")?
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
    )
}

pub(super) fn is_served(status: &Value, name: &str) -> bool {
    status
        .get("gateways")
        .and_then(Value::as_array)
        .is_some_and(|gateways| {
            gateways.iter().any(|gateway| {
                gateway.get("profile").and_then(Value::as_str) == Some(name)
                    || gateway
                        .get("served_profiles")
                        .and_then(Value::as_array)
                        .is_some_and(|served| {
                            served.iter().any(|profile| profile.as_str() == Some(name))
                        })
            })
        })
}

#[tauri::command]
pub async fn list_profiles(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    let mut remote = state.3.lock().await;
    if let Some(active) = remote.as_mut() {
        if active.gateway.is_closed() {
            return Err(DesktopFailure::connection_lost());
        }
        let roster = active
            .gateway
            .request("profiles.list", json!({"include_sessions": false}))
            .await?;
        let names: Vec<String> = roster
            .get("profiles")
            .and_then(Value::as_array)
            .ok_or_else(DesktopFailure::operation_failed)?
            .iter()
            .filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_owned))
            .collect();
        if names.is_empty() {
            return Err(DesktopFailure::operation_failed());
        }
        active.roster = roster.clone();
        if !names.contains(&active.selected_profile) {
            active.selected_profile = names[0].clone();
        }
        return Ok(json!({
            "profiles": roster["profiles"],
            "selected": active.selected_profile,
            "gateway_mode": "remote",
            "gateways": [{"profile": names[0], "served_profiles": names}],
            "reason": null,
        }));
    }
    drop(remote);
    let (client, selected, storage, pid, port, token) = {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        (
            Arc::clone(&backend.gateway),
            backend.selected_profile.clone(),
            backend.storage.clone(),
            backend.child.id(),
            backend.port,
            backend.token.clone(),
        )
    };
    let (roster, status) = state
        .refresh_profile_topology(client, &storage, pid, port, &token)
        .await?;
    Ok(json!({
        "profiles": roster.get("profiles").cloned().unwrap_or_else(|| json!([])),
        "selected": selected,
        "gateway_mode": status.get("gateway_mode").cloned().unwrap_or(Value::Null),
        "gateways": status.get("gateways").cloned().unwrap_or_else(|| json!([])),
        "reason": status.get("multiplex_standalone_reason").cloned().unwrap_or(Value::Null),
    }))
}

#[tauri::command]
pub async fn create_profile(
    state: State<'_, BackendState>,
    name: String,
    preset: Option<ProfilePresetSelection>,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(DesktopFailure::invalid_input());
    }
    if let Some(preset) = &preset {
        if !preset.personality_name.starts_with("hermess_")
            || preset.personality_name.len() > 64
            || !preset
                .personality_name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            || preset.personality_prompt.is_empty()
            || preset.personality_prompt.len() > 4096
            || preset.skills.len() > 16
            || preset.mcp.len() > 8
            || preset.skills.iter().any(|skill| {
                skill.is_empty()
                    || skill.len() > 100
                    || !skill
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            })
            || preset.mcp.iter().any(|name| {
                name.is_empty()
                    || name.len() > 80
                    || !name.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                    })
            })
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
    let mut remote = state.3.lock().await;
    if let Some(active) = remote.as_mut() {
        if !valid_profile_name(name) {
            return Err(DesktopFailure::invalid_input());
        }
        if preset.is_some() {
            return Err("远端网关尚未支持本产品的专家预设，请创建自定义 Profile".into());
        }
        if active.gateway.is_closed() {
            return Err(DesktopFailure::connection_lost());
        }
        let base = remote_connections::normalized_remote_url(&active.base_url)?;
        let url = remote_connections::endpoint_url(&base, "api/profiles")?;
        let created = config::request_url_with_auth(
            reqwest::Method::POST,
            url,
            Some(json!({"name": name, "clone_from_default": false, "clone_channels": false})),
            "X-Hermes-Session-Token",
            active.token.clone(),
            Duration::from_secs(20),
            128 * 1024,
            false,
        )
        .await?;
        if created.get("name").and_then(Value::as_str) != Some(name)
            || created.get("ok").and_then(Value::as_bool) != Some(true)
        {
            return Err(DesktopFailure::operation_failed());
        }
        let mut warnings = Vec::new();
        match active
            .gateway
            .request("profiles.list", json!({"include_sessions": false}))
            .await
        {
            Ok(roster) if roster_contains(&roster, name) => active.roster = roster,
            _ => warnings.push("roster_refresh"),
        }
        return Ok(json!({"name": name, "warnings": warnings}));
    }
    drop(remote);
    let (hermes, home, lock_dir) = {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        (
            backend.hermes.clone(),
            backend.storage.join("hermes-home"),
            backend.storage.join("control").join("gateway-locks"),
        )
    };
    // Use the bundled profile API with no_alias and no credential mirroring. The WS create
    // method defaults to mirroring credentials, which this product must not do implicitly.
    const SCRIPT: &str = r#"import json, sys
from hermes_cli.profiles import create_profile, normalize_profile_name, seed_profile_skills
name = normalize_profile_name(sys.argv[1])
preset = json.loads(sys.argv[2])
path = create_profile(name, no_alias=True, clone_channels=False)
seed_profile_skills(path, quiet=True)
warnings = []
personality_applied = False
if preset:
    try:
        from utils import atomic_roundtrip_yaml_update
        config_path = path / 'config.yaml'
        personality = preset['personalityName']
        atomic_roundtrip_yaml_update(config_path, 'agent.personalities.' + personality,
                                     preset['personalityPrompt'])
        atomic_roundtrip_yaml_update(config_path, 'display.personality', personality)
        personality_applied = True
    except Exception:
        warnings.append('personality')
    try:
        from agent.skill_utils import ESSENTIAL_SKILLS
        skills_root = path / 'skills'
        installed = {entry.parent.name for entry in skills_root.rglob('SKILL.md')} if skills_root.is_dir() else set()
        requested = set(preset['skills'])
        missing = sorted(requested - installed)
        if missing:
            warnings.append('skills_missing:' + ','.join(missing))
        disabled = sorted(installed - requested - ESSENTIAL_SKILLS)
        atomic_roundtrip_yaml_update(path / 'config.yaml', 'skills.disabled', disabled)
    except Exception:
        warnings.append('skills')
    if preset['mcp']:
        import os, subprocess
        mcp_script = '''import sys
from hermes_cli.mcp_catalog import get_entry, card_install_config
from hermes_cli.mcp_config import _save_mcp_server
entry = get_entry(sys.argv[1])
if entry is None or entry.install is not None or entry.auth.type != "none" or entry.auth.env:
    raise SystemExit(2)
if not _save_mcp_server(entry.name, card_install_config(entry)):
    raise SystemExit(3)
'''
        for mcp_name in preset['mcp']:
            try:
                result = subprocess.run([sys.executable, '-c', mcp_script, mcp_name],
                    env={**os.environ, 'HERMES_HOME': str(path)},
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, timeout=20, check=False)
                if result.returncode != 0:
                    warnings.append('mcp:' + mcp_name)
            except Exception:
                warnings.append('mcp:' + mcp_name)
print(json.dumps({'name': name, 'personality_applied': personality_applied, 'warnings': warnings}))
"#;
    let mut command = helper_python::command(&hermes, SCRIPT).map_err(DesktopFailure::from)?;
    command
        .arg(name)
        .arg(serde_json::to_string(&preset).map_err(|_| DesktopFailure::invalid_input())?)
        .env("HERMES_HOME", home)
        .env("PYTHONIOENCODING", "utf-8")
        .env("HERMES_GATEWAY_LOCK_DIR", lock_dir)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(
        Duration::from_secs(90),
        process_manager::output(&mut command, "profile_setup"),
    )
    .await
    .map_err(|_| DesktopFailure::timeout())?
    .map_err(|_| DesktopFailure::operation_failed())?;
    if !output.status.success() {
        return Err(DesktopFailure::operation_failed());
    }
    let result: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| DesktopFailure::operation_failed())?;
    if result.get("name").and_then(Value::as_str).is_none() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(result)
}

#[tauri::command]
pub async fn select_profile(
    state: State<'_, BackendState>,
    name: String,
) -> Result<(), DesktopFailure> {
    let mut remote = state.3.lock().await;
    if let Some(active) = remote.as_mut() {
        if !roster_contains(&active.roster, &name) {
            return Err(DesktopFailure::invalid_input());
        }
        active.selected_profile = name;
        return Ok(());
    }
    drop(remote);
    let (client, storage, pid, port, token) = {
        let owned = state.0.lock().await;
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
    let roster = client
        .request("profiles.list", json!({"include_sessions": false}))
        .await?;
    if !roster_contains(&roster, &name) {
        return Err(DesktopFailure::invalid_input());
    }
    let status = root_status(&storage, pid, port, &token).await?;
    if name != "default" && !is_served(&status, &name) {
        return Err(DesktopFailure::conflict());
    }
    let mut owned = state.0.lock().await;
    let backend = owned
        .as_mut()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    if backend.storage != storage || !Arc::ptr_eq(&backend.gateway, &client) {
        return Err(DesktopFailure::conflict());
    }
    fs::write(storage.join("control").join(SELECTED_FILE), name.as_bytes())
        .map_err(|_| DesktopFailure::operation_failed())?;
    backend.selected_profile = name;
    Ok(())
}

/// A one-use HTTP grant bound to the selected profile, issued by this product's own Gateway.
pub(super) async fn native_http_ticket(
    hermes: &Path,
    home: &Path,
    lock_dir: &Path,
    expected_port: u16,
) -> Result<String, DesktopFailure> {
    const SCRIPT: &str = r#"import sys
from pathlib import Path
from hermes_cli.gateway_runtime import discover_gateway_endpoint
from hermes_cli.gateway_client import _session_ticket
home = Path(sys.argv[1]).resolve()
result = discover_gateway_endpoint(home)
if result.state != 'ready' or result.endpoint is None:
    raise SystemExit(1)
endpoint = result.endpoint
if endpoint.api_origin != 'http://127.0.0.1:' + sys.argv[2]:
    raise SystemExit(1)
print(_session_ticket(home, endpoint, purpose='native-http'))
"#;
    let mut command = helper_python::command(hermes, SCRIPT).map_err(DesktopFailure::from)?;
    command
        .arg(home)
        .arg(expected_port.to_string())
        .env("HERMES_HOME", home)
        .env("HERMES_GATEWAY_LOCK_DIR", lock_dir)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(
        Duration::from_secs(8),
        process_manager::output(&mut command, "profile_ticket"),
    )
    .await
    .map_err(|_| DesktopFailure::timeout())?
    .map_err(|_| DesktopFailure::operation_failed())?;
    if !output.status.success() {
        return Err(DesktopFailure::conflict());
    }
    let ticket =
        String::from_utf8(output.stdout).map_err(|_| DesktopFailure::operation_failed())?;
    let ticket = ticket.trim();
    if ticket.is_empty() || ticket.len() > 256 {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(ticket.to_owned())
}

#[cfg(test)]
#[path = "tests/profiles.rs"]
mod tests;
