use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use std::{collections::HashSet, fs, time::Duration};
use tauri::State;

fn log_plugin_action(
    scope: &ResolvedProfileScope,
    operation: &str,
    name: &str,
    stage: &str,
    outcome: &str,
) {
    // Both identifiers are validated before this is called. Never log HTTP bodies, paths,
    // credentials, request headers or upstream error text.
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "hermes_plugin_action operation={} profile={} plugin={} stage={} outcome={}",
            operation, scope.profile, name, stage, outcome
        ),
    );
}

fn log_install(scope: &ResolvedProfileScope, name: &str, stage: &str, outcome: &str) {
    log_plugin_action(scope, "hermesPlugins.install", name, stage, outcome);
}

fn valid_plugin_identifier(identifier: &str) -> bool {
    let identifier = identifier.trim();
    if identifier.is_empty() || identifier.len() > 2048 || identifier.chars().any(char::is_control)
    {
        return false;
    }
    if identifier.starts_with("https://") {
        return reqwest::Url::parse(identifier).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
        });
    }
    let parts = identifier.split('/').collect::<Vec<_>>();
    parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && *part != "."
                && *part != ".."
                && part.len() <= 200
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        })
}

fn custom_install_body(payload: &Value) -> Result<Option<Value>, DesktopFailure> {
    let Some(identifier) = payload.get("identifier").and_then(Value::as_str) else {
        return Ok(None);
    };
    if payload.get("name").is_some() || !valid_plugin_identifier(identifier) {
        return Err(DesktopFailure::invalid_input());
    }
    let bool_value = |key| match payload.get(key) {
        Some(value) => value.as_bool().ok_or_else(DesktopFailure::invalid_input),
        None => Ok(false),
    };
    Ok(Some(json!({
        "identifier": identifier.trim(),
        "force": bool_value("force")?,
        "enable": bool_value("enable")?,
    })))
}

fn catalog_install_body(name: &str, sha: &Value, payload: &Value) -> Result<Value, DesktopFailure> {
    let enable = match payload.get("enable") {
        Some(value) => value.as_bool().ok_or_else(DesktopFailure::invalid_input)?,
        None => false,
    };
    Ok(json!({"identifier":"", "catalog_name":name, "ref":sha, "enable":enable}))
}

fn context_engine_write_request(
    name: &str,
) -> Result<(Method, &'static str, Value), DesktopFailure> {
    if !valid_context_engine(name) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok((
        Method::PUT,
        "/api/dashboard/plugin-providers",
        json!({"context_engine":name}),
    ))
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    match operation {
        "hermesPlugins.catalog" => live_catalog(state, scope).await,
        "hermesPlugins.list" => list(state, scope).await,
        "hermesPlugins.contextEngines" => context_engines(state, scope).await,
        "hermesPlugins.contextEngine.save" => save_context_engine(state, scope, payload).await,
        "hermesPlugins.rescan" => {
            let _ = append_client_event(
                &scope.storage,
                &format!(
                    "hermes_plugin_rescan profile={} stage=start outcome=pending",
                    scope.profile
                ),
            );
            let result = config_request_for_scope(
                state,
                scope,
                Method::GET,
                "/api/dashboard/plugins/rescan",
                None,
            )
            .await;
            let _ = append_client_event(
                &scope.storage,
                &format!(
                    "hermes_plugin_rescan profile={} stage=finish outcome={}",
                    scope.profile,
                    if result.is_ok() {
                        "completed"
                    } else {
                        "failed"
                    }
                ),
            );
            result
        }
        "hermesPlugins.install" => {
            let result = mutate(state, scope, operation, payload).await;
            let subject = payload
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| valid_plugin_name(name))
                .unwrap_or("custom");
            {
                match &result {
                    Ok(value) if value["ok"] == true => match list(state, scope).await {
                        Ok(installed) => {
                            let installed_name = value["plugin_name"]
                                .as_str()
                                .filter(|name| valid_plugin_name(name))
                                .unwrap_or(subject);
                            let found = installed["installed"].as_array().is_some_and(|rows| {
                                rows.iter().any(|row| {
                                    row["name"] == installed_name
                                        || row["catalog_name"] == installed_name
                                })
                            });
                            log_install(
                                scope,
                                installed_name,
                                "verify",
                                if found { "installed" } else { "missing" },
                            );
                        }
                        Err(error) => {
                            log_install(scope, subject, "verify", &format!("error={error:?}"))
                        }
                    },
                    Ok(value) => log_install(
                        scope,
                        subject,
                        "agent_result",
                        if value["consent_required"] == true {
                            "consent_required"
                        } else if value["scan_blocked"] == true {
                            "scan_blocked"
                        } else {
                            "not_ok"
                        },
                    ),
                    Err(error) => {
                        log_install(scope, subject, "failed", &format!("error={error:?}"))
                    }
                }
            }
            result
        }
        "hermesPlugins.enable"
        | "hermesPlugins.disable"
        | "hermesPlugins.update"
        | "hermesPlugins.remove"
        | "hermesPlugins.visibility" => {
            let name = payload
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| valid_plugin_name(name))
                .ok_or_else(DesktopFailure::invalid_input)?;
            log_plugin_action(scope, operation, name, "start", "pending");
            let result = mutate(state, scope, operation, payload).await;
            let outcome = match &result {
                Ok(value) if value["consent_required"] == true => "consent_required",
                Ok(value) if value["scan_blocked"] == true => "scan_blocked",
                Ok(value) if value["ok"] == true => "completed",
                Ok(_) => "declined",
                Err(_) => "failed",
            };
            log_plugin_action(scope, operation, name, "finish", outcome);
            result
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

async fn list(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let root = scope.home.join("plugins");
    let metadata_path = root.join(".install-metadata.json");
    let records: Value = if metadata_path.exists() {
        let bytes = fs::read(&metadata_path).map_err(|_| DesktopFailure::operation_failed())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(DesktopFailure::operation_failed());
        }
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?
    } else {
        json!({})
    };
    let records = records
        .as_object()
        .ok_or_else(DesktopFailure::operation_failed)?;
    // The installer-owned metadata is the installation authority. An unavailable Hub must
    // not turn every catalog install button off when this product's Gateway is connected.
    let loaded = if scope.profile == "default" {
        tokio::time::timeout(
            Duration::from_secs(4),
            scope.gateway.request("plugins.list", json!({})),
        )
        .await
        .ok()
        .and_then(Result::ok)
    } else {
        None
    };
    let hub = config_request_for_scope(
        state,
        scope,
        Method::GET,
        "/api/dashboard/plugins/hub",
        None,
    )
    .await
    .ok();
    let hub_rows = hub
        .as_ref()
        .and_then(|value| value.get("plugins"))
        .and_then(Value::as_array);
    let mut installed = Vec::new();
    let mut represented_records = HashSet::new();
    if let Some(rows) = hub_rows {
        for row in rows {
            let Some(name) = row
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| valid_plugin_name(name))
            else {
                continue;
            };
            let record_key = row
                .get("path")
                .and_then(Value::as_str)
                .and_then(|path| std::path::Path::new(path).file_name())
                .and_then(|name| name.to_str())
                .filter(|name| valid_plugin_name(name))
                .unwrap_or(name);
            let record = records
                .get(record_key)
                .or_else(|| records.get(name))
                .filter(|record| record.is_object());
            if record.is_some() {
                represented_records.insert(record_key.to_owned());
                represented_records.insert(name.to_owned());
            }
            let catalog_name = record
                .and_then(|record| record.get("catalog"))
                .and_then(|catalog| catalog.get("name"))
                .or_else(|| record.and_then(|record| record.get("catalog_name")))
                .and_then(Value::as_str);
            let installed_sha = record
                .and_then(|record| record.get("catalog"))
                .and_then(|catalog| catalog.get("sha"))
                .or_else(|| record.and_then(|record| record.get("revision")))
                .and_then(Value::as_str);
            let active = loaded
                .as_ref()
                .and_then(|value| value.get("plugins"))
                .and_then(Value::as_array)
                .and_then(|plugins| plugins.iter().find(|plugin| plugin["name"] == name));
            let dashboard = row
                .get("dashboard_manifest")
                .filter(|value| value.is_object());
            installed.push(json!({
                "name": name,
                "version": safe_text(row.get("version"), 120),
                "description": safe_text(row.get("description"), 2000),
                "source": safe_text(row.get("source"), 80),
                "runtime_status": safe_runtime_status(row.get("runtime_status")),
                "catalog_name": catalog_name,
                "installed_sha": installed_sha,
                "loaded": active.and_then(|plugin| plugin.get("enabled")).and_then(Value::as_bool),
                "load_error": active.and_then(|plugin| plugin.get("error")).and_then(Value::as_str)
                    .is_some_and(|error| !error.is_empty()),
                "can_manage": true,
                "can_toggle": true,
                "can_remove": row.get("can_remove").and_then(Value::as_bool).unwrap_or(false),
                "can_update_git": row.get("can_update_git").and_then(Value::as_bool).unwrap_or(false),
                "auth_required": row.get("auth_required").and_then(Value::as_bool).unwrap_or(false),
                "user_hidden": row.get("user_hidden").and_then(Value::as_bool).unwrap_or(false),
                "has_dashboard_manifest": row.get("has_dashboard_manifest").and_then(Value::as_bool).unwrap_or(false),
                "dashboard_label": safe_text(dashboard.and_then(|value| value.get("label")), 120),
                "dashboard_path": safe_dashboard_path(dashboard.and_then(|value| value.pointer("/tab/path"))),
                "dashboard_slots": safe_string_list(dashboard.and_then(|value| value.get("slots")), 24, 80),
                "removed_reason": safe_text(row.get("removed_reason"), 500),
            }));
        }
    }
    // Keep installer-owned records visible when the Hub cannot discover a partially installed
    // plugin. Such rows stay deliberately conservative: no update or dashboard controls are
    // exposed until the authoritative Hub reports them.
    for (name, record) in records {
        if represented_records.contains(name) || !valid_plugin_name(name) || !record.is_object() {
            continue;
        }
        let path = root.join(name);
        if !path
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_dir())
        {
            continue;
        }
        let catalog_name = record
            .get("catalog")
            .and_then(|c| c.get("name"))
            .or_else(|| record.get("catalog_name"))
            .and_then(Value::as_str);
        let installed_sha = record
            .get("catalog")
            .and_then(|c| c.get("sha"))
            .or_else(|| record.get("revision"))
            .and_then(Value::as_str);
        let active = loaded
            .as_ref()
            .and_then(|value| value.get("plugins"))
            .and_then(Value::as_array)
            .and_then(|plugins| {
                plugins
                    .iter()
                    .find(|plugin| plugin["name"] == name.as_str())
            });
        let load_error = active
            .and_then(|plugin| plugin.get("error"))
            .and_then(Value::as_str)
            .is_some_and(|error| !error.is_empty());
        installed.push(json!({
            "name": name,
            "version": "",
            "description": "",
            "source": "user",
            "runtime_status": if active.and_then(|plugin| plugin.get("enabled")).and_then(Value::as_bool) == Some(true) { "enabled" } else { "unknown" },
            "catalog_name": catalog_name,
            "installed_sha": installed_sha,
            "loaded": active.and_then(|plugin| plugin.get("enabled")).and_then(Value::as_bool),
            "load_error": load_error,
            "can_manage": true,
            "can_toggle": true,
            "can_remove": true,
            "can_update_git": false,
            "auth_required": false,
            "user_hidden": false,
            "has_dashboard_manifest": false,
            "dashboard_label": "",
            "dashboard_path": "",
            "dashboard_slots": [],
            "removed_reason": "",
        }));
    }
    let orphan_dashboard_plugins = hub
        .as_ref()
        .and_then(|value| value.get("orphan_dashboard_plugins"))
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let name = row
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|name| valid_plugin_name(name))?;
                    Some(json!({
                        "name": name,
                        "label": safe_text(row.get("label"), 120),
                        "description": safe_text(row.get("description"), 1000),
                        "version": safe_text(row.get("version"), 120),
                        "path": safe_dashboard_path(row.pointer("/tab/path")),
                        "slots": safe_string_list(row.get("slots"), 24, 80),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    scope.ensure_current(state).await?;
    Ok(json!({
        "installed": installed,
        "orphan_dashboard_plugins": orphan_dashboard_plugins,
        "can_manage": true,
        "runtime_status_available": loaded.is_some() || hub_rows.is_some(),
    }))
}

async fn context_engines(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
) -> Result<Value, DesktopFailure> {
    let hub = config_request_for_scope(
        state,
        scope,
        Method::GET,
        "/api/dashboard/plugins/hub",
        None,
    )
    .await?;
    let providers = hub
        .get("providers")
        .and_then(Value::as_object)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let current = providers
        .get("context_engine")
        .and_then(Value::as_str)
        .filter(|name| valid_context_engine(name))
        .unwrap_or("compressor");
    let mut seen = HashSet::new();
    let mut options = vec![json!({"name":"compressor", "description":""})];
    seen.insert("compressor".to_owned());
    if let Some(rows) = providers.get("context_options").and_then(Value::as_array) {
        for row in rows.iter().take(100) {
            let Some(name) = row
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| valid_context_engine(name))
            else {
                continue;
            };
            if seen.insert(name.to_owned()) {
                options.push(json!({
                    "name": name,
                    "description": safe_text(row.get("description"), 1000),
                }));
            }
        }
    }
    if seen.insert(current.to_owned()) {
        options.push(json!({"name":current, "description":""}));
    }
    scope.ensure_current(state).await?;
    Ok(json!({"current":current, "options":options}))
}

async fn save_context_engine(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let requested = payload
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| valid_context_engine(name))
        .ok_or_else(DesktopFailure::invalid_input)?;
    let available = context_engines(state, scope).await?;
    if !available["options"]
        .as_array()
        .is_some_and(|rows| rows.iter().any(|row| row["name"] == requested))
    {
        return Err(DesktopFailure::invalid_input());
    }
    log_plugin_action(
        scope,
        "hermesPlugins.contextEngine.save",
        requested,
        "start",
        "pending",
    );
    let (method, route, body) = context_engine_write_request(requested)?;
    let result = config_request_for_scope(state, scope, method, route, Some(body)).await;
    if result.is_err() {
        log_plugin_action(
            scope,
            "hermesPlugins.contextEngine.save",
            requested,
            "finish",
            "failed",
        );
        return result;
    }
    let readback = context_engines(state, scope).await?;
    if readback["current"] != requested {
        log_plugin_action(
            scope,
            "hermesPlugins.contextEngine.save",
            requested,
            "verify",
            "mismatch",
        );
        return Err(DesktopFailure::conflict());
    }
    log_plugin_action(
        scope,
        "hermesPlugins.contextEngine.save",
        requested,
        "finish",
        "completed",
    );
    Ok(readback)
}

fn safe_text(value: Option<&Value>, max_len: usize) -> &str {
    value
        .and_then(Value::as_str)
        .filter(|value| value.len() <= max_len && !value.chars().any(char::is_control))
        .unwrap_or("")
}

fn safe_runtime_status(value: Option<&Value>) -> &str {
    match value.and_then(Value::as_str) {
        Some("enabled") => "enabled",
        Some("disabled") => "disabled",
        Some("inactive") => "inactive",
        _ => "unknown",
    }
}

fn safe_dashboard_path(value: Option<&Value>) -> &str {
    value
        .and_then(Value::as_str)
        .filter(|path| {
            path.starts_with('/')
                && path.len() <= 160
                && !path.contains("..")
                && !path.contains('\\')
                && !path.chars().any(char::is_control)
        })
        .unwrap_or("")
}

fn safe_string_list(value: Option<&Value>, max_items: usize, max_len: usize) -> Vec<&str> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|item| item.len() <= max_len && !item.chars().any(char::is_control))
                .take(max_items)
                .collect()
        })
        .unwrap_or_default()
}

async fn live_catalog(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
) -> Result<Value, DesktopFailure> {
    let catalog = config_request_for_scope(
        state,
        scope,
        Method::GET,
        "/api/dashboard/plugins/catalog",
        None,
    )
    .await?;
    if !catalog["entries"].is_array() || !catalog["removed"].is_array() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(catalog)
}

fn current_catalog_entry<'a>(
    catalog: &'a Value,
    name: &str,
    expected: &Value,
) -> Result<&'a Value, DesktopFailure> {
    let entry = catalog["entries"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["name"] == name))
        .ok_or_else(DesktopFailure::conflict)?;
    let sha = entry["sha"]
        .as_str()
        .ok_or_else(DesktopFailure::operation_failed)?;
    let repo = entry["repo"]
        .as_str()
        .ok_or_else(DesktopFailure::operation_failed)?;
    if sha.len() != 40
        || !sha.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !repo.starts_with("https://")
        || expected["sha"] != sha
        || expected["repo"] != repo
    {
        return Err(DesktopFailure::conflict());
    }
    if catalog["removed"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["name"] == name || item["repo"] == repo)
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    if entry["platforms"].as_array().is_some_and(|platforms| {
        !platforms.is_empty() && !platforms.iter().any(|item| item == platform)
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(entry)
}

async fn mutate(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    // A named profile's native HTTP ticket binds the request's effective home. The Agent's
    // _plugin_mutation enters _config_profile_scope(None), which retains that ticket scope.
    if operation == "hermesPlugins.install" {
        if let Some(body) = custom_install_body(payload)? {
            log_install(scope, "custom", "start", "pending");
            return write_request(
                state,
                scope,
                Method::POST,
                "/api/dashboard/agent-plugins/install",
                Some(body),
            )
            .await;
        }
    }
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if !valid_plugin_name(name) {
        return Err(DesktopFailure::invalid_input());
    }
    if operation == "hermesPlugins.install" {
        log_install(scope, name, "start", "pending");
    }
    if operation == "hermesPlugins.install" {
        let live = live_catalog(state, scope).await.map_err(|error| {
            log_install(scope, name, "catalog_request", &format!("error={error:?}"));
            error
        })?;
        let current = current_catalog_entry(&live, name, payload).map_err(|error| {
            log_install(scope, name, "catalog_match", &format!("error={error:?}"));
            error
        })?;
        log_install(scope, name, "catalog_match", "matched");
        return write_request(
            state,
            scope,
            Method::POST,
            "/api/dashboard/agent-plugins/install",
            Some(catalog_install_body(name, &current["sha"], payload)?),
        )
        .await;
    }
    // The Hub is re-read immediately before every named operation. Its per-row permissions are
    // the locked Dashboard's authority for update/removal and dashboard visibility.
    let listed = list(state, scope).await?;
    let row = listed["installed"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row["can_manage"] == true && row["name"] == name)
        })
        .ok_or_else(DesktopFailure::invalid_input)?;
    let permitted = match operation {
        "hermesPlugins.enable" | "hermesPlugins.disable" => row["can_toggle"] == true,
        "hermesPlugins.update" => row["can_update_git"] == true,
        "hermesPlugins.remove" => row["can_remove"] == true,
        "hermesPlugins.visibility" => row["has_dashboard_manifest"] == true,
        _ => false,
    };
    if !permitted {
        return Err(DesktopFailure::invalid_input());
    }
    if operation == "hermesPlugins.update" {
        if let Some(catalog_name) = row.get("catalog_name").and_then(Value::as_str) {
            let live = live_catalog(state, scope).await?;
            // The locked Gateway resolves its own current catalog pin during update.
            // Here we only reject entries removed since installation.
            let current = live["entries"]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["name"] == catalog_name))
                .ok_or_else(DesktopFailure::conflict)?;
            if live["removed"].as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item["name"] == catalog_name || item["repo"] == current["repo"])
            }) {
                return Err(DesktopFailure::invalid_input());
            }
        }
    }
    let installed_name = row["name"]
        .as_str()
        .ok_or_else(DesktopFailure::operation_failed)?;
    if !valid_plugin_name(installed_name) {
        return Err(DesktopFailure::invalid_input());
    }
    let (method, route, body) = plugin_mutation_request(operation, installed_name, payload)?;
    write_request(state, scope, method, &route, body).await
}

fn plugin_mutation_request(
    operation: &str,
    installed_name: &str,
    payload: &Value,
) -> Result<(Method, String, Option<Value>), DesktopFailure> {
    if !valid_plugin_name(installed_name) {
        return Err(DesktopFailure::invalid_input());
    }
    match operation {
        "hermesPlugins.enable" => Ok((
            Method::POST,
            format!("/api/dashboard/agent-plugins/{installed_name}/enable"),
            None,
        )),
        "hermesPlugins.disable" => Ok((
            Method::POST,
            format!("/api/dashboard/agent-plugins/{installed_name}/disable"),
            None,
        )),
        "hermesPlugins.update" => Ok((
            Method::POST,
            format!("/api/dashboard/agent-plugins/{installed_name}/update"),
            Some(json!({
                "accept_capabilities": payload.get("accept_capabilities").and_then(Value::as_bool) == Some(true),
                "force": payload.get("force").and_then(Value::as_bool) == Some(true),
            })),
        )),
        "hermesPlugins.remove" => Ok((
            Method::DELETE,
            format!("/api/dashboard/agent-plugins/{installed_name}"),
            None,
        )),
        "hermesPlugins.visibility" => {
            let hidden = payload
                .get("hidden")
                .and_then(Value::as_bool)
                .ok_or_else(DesktopFailure::invalid_input)?;
            Ok((
                Method::POST,
                format!("/api/dashboard/plugins/{installed_name}/visibility"),
                Some(json!({"hidden": hidden})),
            ))
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

fn valid_plugin_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name.split('/').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        })
}

fn valid_context_engine(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'_' | b'-' | b'.'))
}

fn agent_error_category(bytes: &[u8]) -> &'static str {
    let Ok(raw) = serde_json::from_slice::<Value>(bytes) else {
        return "invalid_response";
    };
    let Some(detail) = raw.get("detail").and_then(Value::as_str) else {
        return "missing_detail";
    };
    let detail = detail.to_ascii_lowercase();
    // Only static categories leave this function. Upstream details can contain local paths,
    // URLs, command output or secrets, even when they look like plain text.
    if detail.contains("already installed") {
        "already_installed"
    } else if detail.contains("not in the hermes plugin catalog") {
        "not_in_catalog"
    } else if detail.contains("removed from the hermes plugin catalog") {
        "catalog_removed"
    } else if detail.contains("unsupported") && detail.contains("platform") {
        "unsupported_platform"
    } else if detail.contains("scan") {
        "scan_refused"
    } else if detail.contains("git") || detail.contains("clone") {
        "git_failure"
    } else {
        "other"
    }
}

fn safe_scan_findings(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let severity = safe_text(item.get("severity"), 32);
                    let category = safe_text(item.get("category"), 80);
                    let file = safe_text(item.get("file"), 240);
                    let description = safe_text(item.get("description"), 1000);
                    let relative_file = !file.is_empty()
                        && !file.starts_with('/')
                        && !file.contains("..")
                        && !file.contains(':')
                        && !file.contains('\\');
                    if severity.is_empty()
                        || category.is_empty()
                        || description.is_empty()
                        || !relative_file
                    {
                        return None;
                    }
                    Some(json!({
                        "severity": severity,
                        "category": category,
                        "file": file,
                        "line": item.get("line").and_then(Value::as_u64).filter(|line| *line <= 10_000_000),
                        "description": description,
                    }))
                })
                .take(100)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "tests/hermes_plugins.rs"]
mod tests;

async fn write_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    method: Method,
    route: &str,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    let install_name = (route == "/api/dashboard/agent-plugins/install")
        .then(|| body.as_ref()?.get("catalog_name")?.as_str())
        .flatten()
        .filter(|name| valid_plugin_name(name));
    scope.ensure_current(state).await?;
    let (port, header, token) = scope.http_auth().await.map_err(|error| {
        if let Some(name) = install_name {
            log_install(scope, name, "auth", &format!("error={error:?}"));
        }
        error
    })?;
    scope.ensure_current(state).await?;
    let mut request = super::local_http::client()?
        .request(method, format!("http://127.0.0.1:{port}{route}"))
        .timeout(Duration::from_secs(360))
        .header(header, token);
    if let Some(body) = &body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(|error| {
        if let Some(name) = install_name {
            let reason = if error.is_timeout() {
                "timeout"
            } else if error.is_connect() {
                "connect"
            } else {
                "request"
            };
            log_install(scope, name, "agent_http", reason);
        }
        DesktopFailure::operation_failed()
    })?;
    if let Some(name) = install_name {
        log_install(
            scope,
            name,
            "agent_http",
            &format!("status={}", response.status().as_u16()),
        );
    }
    if !response.status().is_success() {
        if let Some(name) = install_name {
            let category = match response.bytes().await {
                Ok(bytes) if bytes.len() <= 4096 => agent_error_category(&bytes),
                _ => "unreadable_response",
            };
            log_install(scope, name, "agent_error", category);
        }
        return Err(DesktopFailure::operation_failed());
    }
    if response
        .content_length()
        .is_some_and(|size| size > 128 * 1024)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if bytes.len() > 128 * 1024 {
        return Err(DesktopFailure::operation_failed());
    }
    let raw: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    scope.ensure_current(state).await?;
    if let Some(name) = install_name {
        let outcome = if raw["ok"] == true {
            "ok"
        } else if raw["consent_required"] == true {
            "consent_required"
        } else if raw["scan_blocked"] == true {
            "scan_blocked"
        } else {
            "not_ok"
        };
        log_install(scope, name, "agent_response", outcome);
    }
    // Never expose upstream paths, command output or credential-bearing text to the WebView.
    Ok(json!({
        "ok": raw.get("ok").and_then(Value::as_bool).unwrap_or(false),
        "unchanged": raw.get("unchanged").and_then(Value::as_bool).unwrap_or(false),
        "consent_required": raw.get("consent_required").and_then(Value::as_bool).unwrap_or(false),
        "scan_blocked": raw.get("scan_blocked").and_then(Value::as_bool).unwrap_or(false),
        "scan_verdict": match raw.get("scan_verdict").and_then(Value::as_str) {
            Some("caution") => "caution",
            Some("dangerous") => "dangerous",
            Some("clean") => "clean",
            _ => "",
        },
        "scan_findings": safe_scan_findings(raw.get("scan_findings")),
        "restart_required": raw.get("restart_required").and_then(Value::as_bool).unwrap_or(false),
        "gateway_reloaded": raw.get("gateway_reloaded").and_then(Value::as_bool).unwrap_or(false),
        "delta_lines": raw.get("delta_lines").and_then(Value::as_array).map(|lines| lines.iter()
            .filter_map(Value::as_str).filter(|line| line.len() <= 240 && !line.chars().any(char::is_control))
            .take(12).collect::<Vec<_>>()).unwrap_or_default(),
    }))
}
