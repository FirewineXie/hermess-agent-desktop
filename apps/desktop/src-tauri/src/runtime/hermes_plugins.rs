use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use std::{fs, time::Duration};
use tauri::State;

const CATALOG: &str =
    include_str!("../../../../frontend/src/features/extensions/hermesPluginCatalog.generated.json");

fn log_install(scope: &ResolvedProfileScope, name: &str, stage: &str, outcome: &str) {
    // Both identifiers are validated before this is called. Never log HTTP bodies, paths,
    // credentials, request headers or upstream error text.
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "hermes_plugin_install profile={} plugin={} stage={} outcome={}",
            scope.profile, name, stage, outcome
        ),
    );
}

fn catalog() -> Result<Value, DesktopFailure> {
    serde_json::from_str(CATALOG).map_err(|_| DesktopFailure::operation_failed())
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    match operation {
        "hermesPlugins.list" => list(state, scope).await,
        "hermesPlugins.install" => {
            let result = mutate(state, scope, operation, payload).await;
            if let Some(name) = payload
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| valid_plugin_name(name))
            {
                match &result {
                    Ok(value) if value["ok"] == true => match list(state, scope).await {
                        Ok(installed) => {
                            let found = installed["installed"].as_array().is_some_and(|rows| {
                                rows.iter()
                                    .any(|row| row["name"] == name || row["catalog_name"] == name)
                            });
                            log_install(
                                scope,
                                name,
                                "verify",
                                if found { "installed" } else { "missing" },
                            );
                        }
                        Err(error) => {
                            log_install(scope, name, "verify", &format!("error={error:?}"))
                        }
                    },
                    Ok(value) => log_install(
                        scope,
                        name,
                        "agent_result",
                        if value["consent_required"] == true {
                            "consent_required"
                        } else if value["scan_blocked"] == true {
                            "scan_blocked"
                        } else {
                            "not_ok"
                        },
                    ),
                    Err(error) => log_install(scope, name, "failed", &format!("error={error:?}")),
                }
            }
            result
        }
        "hermesPlugins.enable"
        | "hermesPlugins.disable"
        | "hermesPlugins.update"
        | "hermesPlugins.remove" => mutate(state, scope, operation, payload).await,
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
    let hub = if scope.profile != "default" {
        let route = format!("/api/dashboard/plugins/hub?profile={}", scope.profile);
        config_request_for_scope(state, scope, Method::GET, &route, None)
            .await
            .ok()
    } else {
        None
    };
    let hub_rows = hub
        .as_ref()
        .and_then(|value| value.get("plugins"))
        .and_then(Value::as_array);
    let mut installed = Vec::new();
    for (name, record) in records {
        if !valid_plugin_name(name) || !record.is_object() {
            continue;
        }
        let path = root.join(name);
        if !path
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_dir())
        {
            continue;
        }
        let row = hub_rows.and_then(|rows| {
            rows.iter()
                .find(|row| row["path"] == path.to_string_lossy().as_ref())
        });
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
                plugins.iter().find(|plugin| {
                    plugin["name"] == name.as_str()
                        || row.is_some_and(|row| plugin["name"] == row["name"])
                })
            });
        let load_error = active
            .and_then(|plugin| plugin.get("error"))
            .and_then(Value::as_str)
            .is_some_and(|error| !error.is_empty());
        installed.push(json!({
            "name": name,
            "version": row.and_then(|row| row.get("version")).and_then(Value::as_str).unwrap_or(""),
            "description": row.and_then(|row| row.get("description")).and_then(Value::as_str).unwrap_or(""),
            "source": row.and_then(|row| row.get("source")).and_then(Value::as_str).unwrap_or("user"),
            "runtime_status": row.and_then(|row| row.get("runtime_status")).and_then(Value::as_str)
                .unwrap_or(if active.and_then(|plugin| plugin.get("enabled")).and_then(Value::as_bool) == Some(true) { "enabled" } else { "unknown" }),
            "catalog_name": catalog_name,
            "installed_sha": installed_sha,
            "loaded": active.and_then(|plugin| plugin.get("enabled")).and_then(Value::as_bool),
            "load_error": load_error,
            "can_manage": true,
            "removed_reason": row.and_then(|row| row.get("removed_reason")).and_then(Value::as_str).unwrap_or(""),
        }));
    }
    scope.ensure_current(state).await?;
    Ok(
        json!({"installed": installed, "can_manage": true, "runtime_status_available": loaded.is_some() || hub_rows.is_some()}),
    )
}

async fn mutate(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    // A named profile's native HTTP ticket binds the request's effective home. The Agent's
    // _plugin_mutation enters _config_profile_scope(None), which retains that ticket scope.
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
    let snapshot = catalog()?;
    if operation == "hermesPlugins.install" || operation == "hermesPlugins.update" {
        let entry = snapshot["entries"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["name"] == name))
            .ok_or_else(DesktopFailure::invalid_input)?;
        if snapshot["removed"].as_array().is_some_and(|items| {
            items
                .iter()
                .any(|item| item["name"] == name || item["repo"] == entry["repo"])
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
        let live = config_request_for_scope(
            state,
            scope,
            Method::GET,
            "/api/dashboard/plugins/catalog",
            None,
        )
        .await
        .map_err(|error| {
            if operation == "hermesPlugins.install" {
                log_install(scope, name, "catalog_request", &format!("error={error:?}"));
            }
            error
        })?;
        let current = live["entries"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["name"] == name))
            .ok_or_else(|| {
                if operation == "hermesPlugins.install" {
                    log_install(scope, name, "catalog_match", "missing");
                }
                DesktopFailure::conflict()
            })?;
        if current["sha"] != entry["sha"] || current["repo"] != entry["repo"] {
            if operation == "hermesPlugins.install" {
                log_install(scope, name, "catalog_match", "pin_mismatch");
            }
            return Err(DesktopFailure::conflict());
        }
        if operation == "hermesPlugins.install" {
            log_install(scope, name, "catalog_match", "matched");
            return write_request(state, scope, Method::POST, "/api/dashboard/agent-plugins/install",
                Some(json!({"identifier":"", "catalog_name":name, "ref":entry["sha"], "enable":true}))).await;
        }
    }
    // The hub is re-read immediately before a named operation; only installer-owned plugins may be changed.
    let listed = list(state, scope).await?;
    let row = listed["installed"]
        .as_array()
        .and_then(|rows| {
            rows.iter().find(|row| {
                row["can_manage"] == true
                    && (row["name"] == name
                        || (operation == "hermesPlugins.update" && row["catalog_name"] == name))
            })
        })
        .ok_or_else(DesktopFailure::invalid_input)?;
    if operation == "hermesPlugins.update" && row["catalog_name"] != name {
        return Err(DesktopFailure::invalid_input());
    }
    let installed_name = row["name"]
        .as_str()
        .ok_or_else(DesktopFailure::operation_failed)?;
    if !valid_plugin_name(installed_name) {
        return Err(DesktopFailure::invalid_input());
    }
    let action = match operation {
        "hermesPlugins.enable" => "enable",
        "hermesPlugins.disable" => "disable",
        "hermesPlugins.update" => "update",
        "hermesPlugins.remove" => "",
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let route = if action.is_empty() {
        format!("/api/dashboard/agent-plugins/{installed_name}")
    } else {
        format!("/api/dashboard/agent-plugins/{installed_name}/{action}")
    };
    write_request(
        state,
        scope,
        if action.is_empty() {
            Method::DELETE
        } else {
            Method::POST
        },
        &route,
        if action == "update" {
            Some(json!({"accept_capabilities": payload.get("accept_capabilities").and_then(Value::as_bool) == Some(true)}))
        } else {
            None
        },
    )
    .await
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
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(360))
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut request = client
        .request(method, format!("http://127.0.0.1:{port}{route}"))
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
        "consent_required": raw.get("consent_required").and_then(Value::as_bool).unwrap_or(false),
        "scan_blocked": raw.get("scan_blocked").and_then(Value::as_bool).unwrap_or(false),
        "restart_required": raw.get("restart_required").and_then(Value::as_bool).unwrap_or(false),
        "gateway_reloaded": raw.get("gateway_reloaded").and_then(Value::as_bool).unwrap_or(false),
        "delta_lines": raw.get("delta_lines").and_then(Value::as_array).map(|lines| lines.iter()
            .filter_map(Value::as_str).filter(|line| line.len() <= 240 && !line.chars().any(char::is_control))
            .take(12).collect::<Vec<_>>()).unwrap_or_default(),
    }))
}
