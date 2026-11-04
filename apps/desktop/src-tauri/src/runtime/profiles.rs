use super::{
    helper_python, hermes_process_path,
    profile_create_adapter::{
        create_payload, spawn_hub_installs, validate_builder_options, validate_preset,
        write_payload, ProfileCreateOptions, CREATE_PROFILE_SCRIPT,
    },
    profile_scope::{valid_profile_name, SessionOwners},
    BackendState,
};
use crate::errors::{DesktopFailure, SESSION_PROFILE_MISMATCH};
use crate::gateway::{GatewayClient, GatewayRequestError};
use crate::process_manager;
use serde_json::{json, Value};
use std::{fs, path::Path, sync::Arc, time::Duration};
use tauri::State;
use tokio::time::timeout;
use uuid::Uuid;

const SELECTED_FILE: &str = "selected-profile";

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
        self.request_detailed(method, params)
            .await
            .map_err(|error| error.to_string())
    }

    pub(super) async fn request_detailed(
        &self,
        method: &'static str,
        params: Value,
    ) -> Result<Value, GatewayRequestError> {
        let requested_session = params
            .get("session_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        let branching = method == "session.mutate" && params["operation"] == "branch";
        if !matches!(method, "session.create" | "session.list" | "session.resume") {
            if let Some(session_id) = requested_session.as_deref() {
                self.session_owners
                    .ensure(&self.profile, session_id)
                    .map_err(GatewayRequestError::Transport)?;
            }
        }
        let params =
            scoped_params(&self.profile, method, params).map_err(GatewayRequestError::Transport)?;
        let result = self.client.request_detailed(method, params).await?;
        match method {
            "session.create" => {
                for key in ["session_id", "stored_session_id"] {
                    if let Some(id) = result.get(key).and_then(Value::as_str) {
                        self.session_owners
                            .record(&self.profile, id)
                            .map_err(GatewayRequestError::Transport)?;
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
                            self.session_owners
                                .record(&self.profile, id)
                                .map_err(GatewayRequestError::Transport)?;
                        }
                    }
                }
            }
            "session.resume" => {
                if let Some(id) = requested_session.as_deref() {
                    self.session_owners
                        .record(&self.profile, id)
                        .map_err(GatewayRequestError::Transport)?;
                }
                if let Some(id) = result.get("session_id").and_then(Value::as_str) {
                    self.session_owners
                        .record(&self.profile, id)
                        .map_err(GatewayRequestError::Transport)?;
                }
            }
            "session.mutate" if branching => {
                if let Some(id) = result.get("branched_session_id").and_then(Value::as_str) {
                    self.session_owners
                        .record(&self.profile, id)
                        .map_err(GatewayRequestError::Transport)?;
                }
            }
            _ => {}
        }
        Ok(result)
    }

    /// Only an already prepared delete receipt may use this path. The Gateway validates
    /// its original principal, profile, request id and CAS tuple even after reconnect.
    pub(super) async fn retry_delete(&self, params: Value) -> Result<Value, GatewayRequestError> {
        let params = scoped_params(&self.profile, "session.mutate", params)
            .map_err(GatewayRequestError::Transport)?;
        self.client.request_detailed("session.mutate", params).await
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
            | "session.active_list"
            | "session.resume"
            | "session.detach"
            | "session.interrupt"
            | "session.steer"
            | "prompt.receipt"
            | "prompt.cancel"
            | "prompt.replace_queued"
            | "prompt.btw"
            | "prompt.background"
            | "session.stats"
            | "session.export"
            | "session.mutate"
            | "session.events.since"
            | "prompt.submit"
            | "clarify.lock"
            | "commands.catalog"
            | "slash.exec"
            | "command.dispatch"
            | "subagent.list"
            | "image.attach"
            | "image.attach_bytes"
            | "image.detach"
            | "file.attach"
            | "config.get"
            | "config.set"
            | "model.options"
            | "browser.manage"
            | "reload.mcp"
            | "skills.reload"
            | "cron.manage"
            | "setup.runtime_check"
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

pub(super) async fn settle_renamed_selection(
    state: &State<'_, BackendState>,
    client: &Arc<GatewayClient>,
    storage: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<bool, DesktopFailure> {
    let mut persisted = true;
    {
        let mut owned = state.0.lock().await;
        let backend = owned
            .as_mut()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        if backend.storage != storage || !Arc::ptr_eq(&backend.gateway, client) {
            return Err(DesktopFailure::conflict());
        }
        if backend.selected_profile == old_name {
            backend.selected_profile = new_name.to_owned();
            persisted = fs::write(
                storage.join("control").join(SELECTED_FILE),
                new_name.as_bytes(),
            )
            .is_ok();
        }
    }
    state.2.lock().await.take();
    Ok(persisted)
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
    let response = super::local_http::client()?
        .get(format!("http://127.0.0.1:{port}/api/status"))
        .timeout(Duration::from_secs(8))
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
    options: Option<ProfileCreateOptions>,
) -> Result<Value, DesktopFailure> {
    create_profile_with_options(state, name, options, None).await
}

pub(super) async fn create_import_profile(
    state: State<'_, BackendState>,
    name: String,
    soul: String,
) -> Result<Value, DesktopFailure> {
    create_profile_with_options(state, name, None, Some(soul)).await
}

async fn create_profile_with_options(
    state: State<'_, BackendState>,
    name: String,
    options: Option<ProfileCreateOptions>,
    soul: Option<String>,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    if !valid_profile_name(name) || name == "default" {
        return Err(DesktopFailure::invalid_input());
    }
    if let Some(preset) = options.as_ref().and_then(|value| value.preset.as_ref()) {
        validate_preset(preset)?;
    }
    if let Some(options) = &options {
        validate_builder_options(options)?;
        if options.preset.is_some() && options.clone_from.is_some()
            || options.preset.is_some()
                && (options.provider.is_some()
                    || options.model.is_some()
                    || options.no_skills
                    || options
                        .keep_skills
                        .as_ref()
                        .is_some_and(|value| !value.is_empty())
                    || options
                        .hub_skills
                        .as_ref()
                        .is_some_and(|value| !value.is_empty())
                    || options
                        .mcp_servers
                        .as_ref()
                        .is_some_and(|value| !value.is_empty()))
            || options.clone_all && options.clone_from.is_none()
            || options
                .clone_from
                .as_deref()
                .is_some_and(|source| !valid_profile_name(source) || source == name)
            || options
                .description
                .as_deref()
                .is_some_and(|description| description.len() > 1024)
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
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
    let storage = home
        .parent()
        .ok_or_else(DesktopFailure::operation_failed)?
        .to_path_buf();
    // Keep the bundled profile creation atomic, but disable its implicit model/provider seed
    // in this short-lived helper process. A fresh desktop Profile owns an empty model setup.
    let mut command =
        helper_python::command(&hermes, CREATE_PROFILE_SCRIPT).map_err(DesktopFailure::from)?;
    let payload_path = write_payload(
        &storage,
        &create_payload(name, options.as_ref(), soul.as_deref()),
    )?;
    command
        .arg(name)
        .arg(&payload_path)
        .env("HERMES_HOME", &home)
        .env("PYTHONIOENCODING", "utf-8")
        .env("HERMES_GATEWAY_LOCK_DIR", &lock_dir)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mode = options
        .as_ref()
        .and_then(|value| value.clone_from.as_ref())
        .map(|_| {
            if options.as_ref().is_some_and(|value| value.clone_all) {
                "clone_all"
            } else {
                "clone_config"
            }
        })
        .unwrap_or("fresh");
    let builder = options.as_ref().is_some_and(|value| {
        value.provider.is_some()
            || value.no_skills
            || value
                .keep_skills
                .as_ref()
                .is_some_and(|items| !items.is_empty())
            || value
                .hub_skills
                .as_ref()
                .is_some_and(|items| !items.is_empty())
            || value
                .mcp_servers
                .as_ref()
                .is_some_and(|items| !items.is_empty())
    });
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_create_start profile={name} mode={mode} builder={builder}"),
    );
    let output_result = timeout(
        Duration::from_secs(90),
        process_manager::output(&mut command, "profile_setup"),
    )
    .await;
    let _ = fs::remove_file(&payload_path);
    let output = match output_result {
        Err(_) => {
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!("profile_create_failed profile={name} reason=timeout"),
            );
            return Err(DesktopFailure::timeout());
        }
        Ok(Err(_)) => {
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!("profile_create_failed profile={name} reason=process"),
            );
            return Err(DesktopFailure::operation_failed());
        }
        Ok(Ok(output)) => output,
    };
    if !output.status.success() {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            &format!("profile_create_failed profile={name} reason=exit_status"),
        );
        return Err(DesktopFailure::operation_failed());
    }
    let mut result: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| DesktopFailure::operation_failed())?;
    let profile_name = result
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?
        .to_owned();
    if result
        .get("windows_rename_retries")
        .and_then(Value::as_u64)
        .is_some_and(|retries| retries > 0)
    {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            &format!("profile_create_windows_rename_retried profile={profile_name}"),
        );
    }
    let hub_skills = options
        .as_ref()
        .and_then(|value| value.hub_skills.as_deref())
        .unwrap_or(&[]);
    let (hub_installs, hub_warnings) = spawn_hub_installs(
        &hermes,
        &storage,
        &home,
        &lock_dir,
        &profile_name,
        hub_skills,
    )
    .await;
    result["hub_installs"] = Value::Array(hub_installs);
    if let Some(warnings) = result.get_mut("warnings").and_then(Value::as_array_mut) {
        warnings.extend(hub_warnings.into_iter().map(Value::String));
    }
    #[cfg(windows)]
    {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            &format!("powershell_tool_profile_install_start profile={profile_name}"),
        );
        if let Err(error) = super::powershell_tool::install_new_profile(&home, &profile_name) {
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!(
                    "powershell_tool_profile_install_failed profile={profile_name} error={error}"
                ),
            );
            if let Some(warnings) = result.get_mut("warnings").and_then(Value::as_array_mut) {
                warnings.push(Value::String("powershell_tool".into()));
            }
        } else {
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!("powershell_tool_profile_install_completed profile={profile_name}"),
            );
            let reloaded =
                reload_named_powershell_plugin(&hermes, &home, &lock_dir, &profile_name).await;
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!(
                    "powershell_tool_profile_reload_{} profile={profile_name}",
                    if reloaded { "completed" } else { "pending" }
                ),
            );
        }
    }
    let _ =
        crate::diagnostics::append_client_event(&storage, "product_skill_profile_install_start");
    if super::product_skill::install_new_profile(&home, &profile_name).is_err() {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            "product_skill_profile_install_failed",
        );
        if let Some(warnings) = result.get_mut("warnings").and_then(Value::as_array_mut) {
            warnings.push(Value::String("product_skill".into()));
        }
    } else {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            "product_skill_profile_install_completed",
        );
    }
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_create_completed profile={profile_name}"),
    );
    Ok(result)
}

#[cfg(windows)]
async fn reload_named_powershell_plugin(
    hermes: &Path,
    home: &Path,
    lock_dir: &Path,
    name: &str,
) -> bool {
    const SCRIPT: &str = r#"import json, sys
from pathlib import Path
from gateway.control_socket import reload_gateway_plugins
result = reload_gateway_plugins(Path(sys.argv[1]), profile_home=Path(sys.argv[2]), timeout=5.0)
print(json.dumps({'reloaded': bool(result and result.get('reloaded'))}))
"#;
    let Ok(mut command) = helper_python::command(hermes, SCRIPT) else {
        return false;
    };
    command
        .arg(hermes_process_path(home))
        .arg(hermes_process_path(&home.join("profiles").join(name)))
        .env("HERMES_HOME", hermes_process_path(home))
        .env("HERMES_GATEWAY_LOCK_DIR", hermes_process_path(lock_dir))
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    command.creation_flags(0x08000000);
    let Ok(Ok(output)) = timeout(
        Duration::from_secs(8),
        process_manager::output(&mut command, "powershell_plugin_reload"),
    )
    .await
    else {
        return false;
    };
    output.status.success()
        && serde_json::from_slice::<Value>(&output.stdout)
            .ok()
            .and_then(|value| value.get("reloaded").and_then(Value::as_bool))
            == Some(true)
}

#[tauri::command]
pub async fn activate_profile(
    state: State<'_, BackendState>,
    name: String,
) -> Result<(), DesktopFailure> {
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
    let operation_id = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_activate_start operation_id={operation_id} profile={name}"),
    );
    let result = async {
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
        backend.selected_profile = name.clone();
        Ok(())
    }
    .await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_activate_{outcome} operation_id={operation_id} profile={name}"),
    );
    result
}

#[tauri::command]
pub async fn delete_profile(
    state: State<'_, BackendState>,
    name: String,
) -> Result<Value, DesktopFailure> {
    if name == "default" || !valid_profile_name(&name) {
        return Err(DesktopFailure::invalid_input());
    }
    let (client, storage, port, token) = {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        (
            Arc::clone(&backend.gateway),
            backend.storage.clone(),
            backend.port,
            backend.token.clone(),
        )
    };
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_delete_start profile={name}"),
    );
    let result =
        delete_profile_from_owned_gateway(&state, &name, &client, &storage, port, &token).await;
    let outcome = match &result {
        Ok(value) if value.get("settlement_pending").and_then(Value::as_bool) == Some(true) => {
            "pending"
        }
        Ok(_) => "completed",
        Err(_) => "failed",
    };
    let detail = result
        .as_ref()
        .err()
        .map(|error| format!(" error={error:?}"))
        .unwrap_or_default();
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_delete_{outcome} profile={name}{detail}"),
    );
    result
}

async fn delete_profile_from_owned_gateway(
    state: &State<'_, BackendState>,
    name: &str,
    client: &Arc<GatewayClient>,
    storage: &Path,
    port: u16,
    token: &str,
) -> Result<Value, DesktopFailure> {
    let roster = client
        .request("profiles.list", json!({"include_sessions": false}))
        .await?;
    if !roster_contains(&roster, name) {
        return Err(DesktopFailure::invalid_input());
    }
    {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        if backend.storage != storage
            || backend.port != port
            || !Arc::ptr_eq(&backend.gateway, client)
        {
            return Err(DesktopFailure::conflict());
        }
    }
    let url = format!("http://127.0.0.1:{port}/api/profiles/{name}");
    let response = super::local_http::client()?
        .delete(url)
        .timeout(Duration::from_secs(100))
        .header("X-Hermes-Session-Token", token)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                DesktopFailure::timeout()
            } else {
                DesktopFailure::operation_failed()
            }
        })?;
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let result: Value = response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::operation_failed());
    }
    {
        let mut owned = state.0.lock().await;
        if let Some(backend) = owned.as_mut() {
            if backend.storage == storage
                && Arc::ptr_eq(&backend.gateway, client)
                && backend.selected_profile == name
            {
                backend.selected_profile = "default".into();
                if fs::write(storage.join("control").join(SELECTED_FILE), b"default").is_err() {
                    let _ = crate::diagnostics::append_client_event(
                        storage,
                        &format!("profile_delete_selection_persist_failed profile={name}"),
                    );
                }
            }
        }
    }
    state.2.lock().await.take();
    Ok(
        json!({"settlement_pending": result.get("settlement_pending").and_then(Value::as_bool) == Some(true)}),
    )
}

#[tauri::command]
pub async fn set_profile_display_name(
    state: State<'_, BackendState>,
    name: String,
    display_name: String,
) -> Result<Value, DesktopFailure> {
    let label = display_name.trim();
    if !valid_profile_name(&name) || !valid_display_name(label) {
        return Err(DesktopFailure::invalid_input());
    }
    let (client, hermes, storage) = {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        (
            Arc::clone(&backend.gateway),
            backend.hermes.clone(),
            backend.storage.clone(),
        )
    };
    let roster = client
        .request("profiles.list", json!({"include_sessions": false}))
        .await?;
    if !roster_contains(&roster, &name) {
        return Err(DesktopFailure::invalid_input());
    }
    {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        if backend.storage != storage || !Arc::ptr_eq(&backend.gateway, &client) {
            return Err(DesktopFailure::conflict());
        }
    }
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_display_name_start profile={name}"),
    );
    const SCRIPT: &str = r#"import json, sys
from hermes_cli.profiles import set_profile_display_name
print(json.dumps({'display_name': set_profile_display_name(sys.argv[1], sys.argv[2])}))
"#;
    let mut command = helper_python::command(&hermes, SCRIPT).map_err(DesktopFailure::from)?;
    command
        .arg(&name)
        .arg(label)
        .env(
            "HERMES_HOME",
            hermes_process_path(&storage.join("hermes-home")),
        )
        .env(
            "HERMES_GATEWAY_LOCK_DIR",
            hermes_process_path(&storage.join("control").join("gateway-locks")),
        )
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(
        Duration::from_secs(12),
        process_manager::output(&mut command, "profile_display_name"),
    )
    .await;
    let output = match output {
        Ok(Ok(output)) => output,
        Ok(Err(_)) => {
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!("profile_display_name_failed profile={name}"),
            );
            return Err(DesktopFailure::operation_failed());
        }
        Err(_) => {
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!("profile_display_name_timeout profile={name}"),
            );
            return Err(DesktopFailure::timeout());
        }
    };
    if !output.status.success() {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            &format!("profile_display_name_failed profile={name}"),
        );
        return Err(DesktopFailure::operation_failed());
    }
    let result: Value = match serde_json::from_slice(&output.stdout) {
        Ok(value) => value,
        Err(_) => {
            let _ = crate::diagnostics::append_client_event(
                &storage,
                &format!("profile_display_name_invalid_response profile={name}"),
            );
            return Err(DesktopFailure::operation_failed());
        }
    };
    if result.get("display_name").and_then(Value::as_str) != Some(label) {
        let _ = crate::diagnostics::append_client_event(
            &storage,
            &format!("profile_display_name_mismatch profile={name}"),
        );
        return Err(DesktopFailure::operation_failed());
    }
    state.2.lock().await.take();
    let _ = crate::diagnostics::append_client_event(
        &storage,
        &format!("profile_display_name_completed profile={name}"),
    );
    Ok(result)
}

fn valid_display_name(label: &str) -> bool {
    !label.is_empty() && label.chars().count() <= 64 && !label.chars().any(char::is_control)
}

#[cfg(test)]
#[path = "tests/profiles.rs"]
mod tests;
