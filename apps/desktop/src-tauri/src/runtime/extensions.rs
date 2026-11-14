use super::{
    agent_migration, config::config_request_for_scope, credential_pool, curator, dashboard_plugins,
    daybreak, env_keys, hermes_plugins, hooks, jobs, logs, managed_files, mcp_registry, modelscope,
    modelscope_mcp, pairing, profile_scope::ResolvedProfileScope, session_management,
    system_actions, tools, vault_keys, webhooks, BackendState,
};
use crate::errors::DesktopFailure;
use crate::paths::filesystem_path;
use reqwest::{Method, Url};
use serde_json::Value;
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

const MCP_STATUS_METHOD: &str = "mcp.servers.status";

fn field<'a>(body: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let value = body.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn skill_lock_body(profile: &str, payload: &Value) -> Result<Value, DesktopFailure> {
    Ok(serde_json::json!({
        "name": field(payload, "name", 200)?,
        "locked": payload.get("locked").and_then(Value::as_bool)
            .ok_or_else(DesktopFailure::invalid_input)?,
        "profile": profile,
    }))
}

#[tauri::command]
pub async fn extension_request(
    state: State<'_, BackendState>,
    profile: String,
    operation: String,
    payload: Value,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    if operation.starts_with("hermesPlugins.") {
        return hermes_plugins::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("jobs.") {
        return jobs::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("vault.key.") {
        return vault_keys::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("agent.migration.") {
        return agent_migration::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("hooks.") {
        return hooks::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("curator.") {
        return curator::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("systemActions.") {
        return system_actions::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("credentials.pool.") {
        return credential_pool::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("webhooks.") {
        return webhooks::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("pairing.") {
        return pairing::request(&state, &scope, &operation, &payload).await;
    }
    if operation == "logs.read" {
        return logs::read(&state, &scope, &payload).await;
    }
    if operation.starts_with("envKeys.") {
        return env_keys::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("sessionManagement.") {
        return session_management::request(&state, &scope, &operation, &payload).await;
    }
    if operation.starts_with("managedFiles.") {
        return managed_files::request(&state, &scope, &operation, &payload).await;
    }
    if (operation.starts_with("toolsets.") && operation != "toolsets.toggle")
        || operation == "skills.lock"
    {
        let payload = if operation == "skills.lock" {
            skill_lock_body(&scope.profile, &payload)?
        } else {
            payload
        };
        let operation_id = Uuid::new_v4();
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("{operation}_start operation_id={operation_id} profile={profile}"),
        );
        let result = upstream_request(&state, &scope, &operation, &payload).await;
        let outcome = if result.is_ok() {
            "completed"
        } else {
            "failed"
        };
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("{operation}_{outcome} operation_id={operation_id} profile={profile}"),
        );
        return result;
    }
    if operation == "mcp.auth.cancel" {
        let operation_id = Uuid::new_v4();
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("mcp_oauth_cancel_start operation_id={operation_id} profile={profile}"),
        );
        let result = upstream_request(&state, &scope, &operation, &payload).await;
        let outcome = if result.is_ok() {
            "completed"
        } else {
            "failed"
        };
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("mcp_oauth_cancel_{outcome} operation_id={operation_id} profile={profile}"),
        );
        return result;
    }
    match operation.as_str() {
        "daybreak.status" | "daybreak.set" => {
            return daybreak::request(&state, &scope, &operation, &payload).await
        }
        "skills.review-capability" => {
            return review_capability(&state, &scope).await;
        }
        "memory.provider.activate" => {
            return activate_memory_provider(&state, &scope, &profile, &payload).await;
        }
        "dashboard.plugins.list" | "dashboard.plugins.request" => {
            return dashboard_plugins::request(&state, &scope, &operation, &payload).await;
        }
        "toolsets.toggle" => return tools::toggle_profile_toolset(&state, &scope, &payload).await,
        "journey.graph" | "journey.node" | "journey.edit" | "journey.delete" => {
            return journey_request(&state, &scope, &profile, &operation, &payload).await;
        }
        "mcp.update" => return update_mcp_server(&state, &scope, &payload).await,
        "mcp.status" => {
            let id = Uuid::new_v4();
            let log = |phase| {
                let _ = crate::diagnostics::append_client_event(
                    &scope.storage,
                    &format!("mcp_status operation={id} profile={profile} phase={phase}"),
                );
            };
            log("start");
            let result = async {
                scope.ensure_current(&state).await?;
                let result = scope
                    .gateway
                    .request(MCP_STATUS_METHOD, serde_json::json!({}))
                    .await;
                scope.ensure_current(&state).await?;
                let value = result.map_err(|_| DesktopFailure::operation_failed())?;
                let servers = value["servers"]
                    .as_array()
                    .ok_or_else(DesktopFailure::operation_failed)?;
                let names = servers
                    .iter()
                    .filter(|row| row["needs_auth"] == true)
                    .filter_map(|row| row["name"].as_str())
                    .collect::<Vec<_>>();
                Ok(serde_json::json!({"needs_auth": names}))
            }
            .await;
            log(if result.is_ok() {
                "completed"
            } else {
                "failed"
            });
            return result;
        }
        "mcp.modelscope.search" => {
            let query = payload.get("q").and_then(Value::as_str).unwrap_or("");
            return modelscope_mcp::search(query).await;
        }
        "mcp.modelscope.preview" => {
            return modelscope_mcp::preview(field(&payload, "identifier", 220)?).await;
        }
        "mcp.modelscope.install" => {
            let identifier = field(&payload, "identifier", 220)?;
            let expected_url = field(&payload, "url", 2048)?;
            let auth = payload
                .get("auth")
                .and_then(Value::as_str)
                .unwrap_or("none");
            if auth != "none" && auth != "oauth" {
                return Err(DesktopFailure::invalid_input());
            }
            let detail = modelscope_mcp::preview(identifier).await?;
            if detail.get("url").and_then(Value::as_str) != Some(expected_url) {
                return Err(DesktopFailure::conflict());
            }
            let name = detail
                .get("install_name")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::operation_failed)?;
            return upstream_request(
                &state,
                &scope,
                "mcp.add",
                &serde_json::json!({"name": name, "url": expected_url, "auth": auth}),
            )
            .await;
        }
        "mcp.registry.search" => {
            let query = payload.get("q").and_then(Value::as_str).unwrap_or("");
            return mcp_registry::search(query).await;
        }
        "mcp.registry.preview" => {
            return mcp_registry::preview(field(&payload, "identifier", 200)?).await;
        }
        "mcp.registry.install" => {
            let name = field(&payload, "identifier", 200)?;
            let version = field(&payload, "version", 100)?;
            let expected_url = field(&payload, "url", 2048)?;
            let auth = payload
                .get("auth")
                .and_then(Value::as_str)
                .unwrap_or("none");
            if auth != "none" && auth != "oauth" {
                return Err(DesktopFailure::invalid_input());
            }
            let detail = mcp_registry::preview(name).await?;
            if detail.get("version").and_then(Value::as_str) != Some(version)
                || detail.get("url").and_then(Value::as_str) != Some(expected_url)
            {
                return Err(DesktopFailure::conflict());
            }
            let address = detail
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::invalid_input)?;
            return upstream_request(
                &state,
                &scope,
                "mcp.add",
                &serde_json::json!({"name": name, "url": address, "auth": auth}),
            )
            .await;
        }
        "modelscope.installed" => return modelscope::installed(&scope.storage, &scope.home),
        "modelscope.install" => {
            let storage = scope.storage.clone();
            let existing =
                upstream_request(&state, &scope, "skills.list", &serde_json::json!({})).await?;
            let names: Vec<String> = existing
                .as_array()
                .ok_or_else(DesktopFailure::operation_failed)?
                .iter()
                .filter_map(|skill| skill.get("name").and_then(Value::as_str).map(str::to_owned))
                .collect();
            scope.ensure_current(&state).await?;
            return modelscope::install(
                &storage,
                &scope.home,
                field(&payload, "identifier", 220)?,
                field(&payload, "digest", 64)?,
                payload.get("confirmed").and_then(Value::as_bool) == Some(true),
                &names,
            )
            .await;
        }
        "modelscope.uninstall" => {
            let storage = scope.storage.clone();
            let home = scope.home.clone();
            let name = field(&payload, "name", 200)?.to_owned();
            scope.ensure_current(&state).await?;
            return tauri::async_runtime::spawn_blocking(move || {
                modelscope::uninstall(&storage, &home, &name)
            })
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        }
        "skills.preview" | "skills.scan" => {
            let identifier = field(&payload, "identifier", 220)?;
            if identifier.starts_with("modelscope:") {
                return if operation == "skills.preview" {
                    modelscope::preview(identifier).await
                } else {
                    modelscope::scan(identifier).await
                };
            }
        }
        "skills.search" => {
            let source = payload
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or("all");
            if source == "modelscope" {
                let query = payload.get("q").and_then(Value::as_str).unwrap_or("");
                return modelscope::search(query).await;
            }
            let query = field(&payload, "q", 500)?;
            if source == "all" {
                let (upstream, external) = tokio::join!(
                    upstream_request(&state, &scope, &operation, &payload),
                    modelscope::search(query),
                );
                match (upstream, external) {
                    (Ok(mut response), Ok(extra)) => {
                        if let (Some(results), Some(items)) = (
                            response.get_mut("results").and_then(Value::as_array_mut),
                            extra.get("results").and_then(Value::as_array),
                        ) {
                            results.extend(items.iter().cloned());
                        }
                        return Ok(response);
                    }
                    (Ok(mut response), Err(_)) => {
                        response["source_errors"] = serde_json::json!(["modelscope"]);
                        return Ok(response);
                    }
                    (Err(_), Ok(mut response)) => {
                        response["source_errors"] = serde_json::json!(["hermes"]);
                        return Ok(response);
                    }
                    (Err(error), Err(_)) => return Err(error),
                }
            }
        }
        "skills.sources" => {
            let mut response = upstream_request(&state, &scope, &operation, &payload).await?;
            if let Some(sources) = response.get_mut("sources").and_then(Value::as_array_mut) {
                sources.push(serde_json::json!({"id": "modelscope", "label": "ModelScope"}));
            }
            return Ok(response);
        }
        _ => {}
    }
    upstream_request(&state, &scope, &operation, &payload).await
}

async fn review_capability(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
) -> Result<Value, DesktopFailure> {
    let skills = upstream_request(state, scope, "skills.list", &serde_json::json!({})).await?;
    let raw = config_request_for_scope(state, scope, Method::GET, "/api/config/raw", None).await?;
    let yaml = raw
        .get("yaml")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let config: Value =
        serde_yaml::from_str(yaml).map_err(|_| DesktopFailure::operation_failed())?;
    scope.ensure_current(state).await?;
    review_capability_value(
        &skills,
        &config,
        filesystem_path(&scope.home.join(".no-bundled-skills")).is_file(),
    )
}

fn review_capability_value(
    skills: &Value,
    config: &Value,
    bundled_skills_omitted: bool,
) -> Result<Value, DesktopFailure> {
    let listed = skills
        .as_array()
        .ok_or_else(DesktopFailure::operation_failed)?;
    if listed.iter().any(|skill| {
        skill.get("name").and_then(Value::as_str) == Some("sdlc-review")
            && skill.get("enabled").and_then(Value::as_bool) == Some(true)
    }) {
        return Ok(serde_json::json!({"capability": "ready", "reason": "listed"}));
    }
    let disabled = config
        .get("skills")
        .and_then(|value| value.get("disabled"))
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items
                .iter()
                .any(|item| item.as_str() == Some("sdlc-review"))
        });
    if disabled {
        return Ok(serde_json::json!({"capability": "missing", "reason": "disabled"}));
    }

    if bundled_skills_omitted {
        return Ok(
            serde_json::json!({"capability": "missing", "reason": "bundled_skills_omitted"}),
        );
    }

    // sdlc-review is part of the locked official bundle. Editable development
    // checkouts can resolve it for workers without exposing it through /api/skills,
    // so an enabled full-bundle profile remains review-capable here.
    Ok(serde_json::json!({"capability": "ready", "reason": "bundled"}))
}

fn memory_provider_request_shape(
    profile: &str,
    payload: &Value,
) -> Result<(Method, String, Value), DesktopFailure> {
    let provider = payload
        .get("provider")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?
        .trim();
    if !provider.is_empty()
        && (provider.len() > 64
            || !provider.as_bytes()[0].is_ascii_alphanumeric()
            || !provider
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut url = Url::parse("http://localhost/api/memory/provider")
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.query_pairs_mut().append_pair("profile", profile);
    Ok((
        Method::PUT,
        format!("{}?{}", url.path(), url.query().unwrap_or_default()),
        serde_json::json!({ "provider": provider }),
    ))
}

async fn activate_memory_provider(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    profile: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let (method, path, body) = memory_provider_request_shape(profile, payload)?;
    let operation_id = Uuid::new_v4();
    let provider = body
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let target = if provider.is_empty() {
        "builtin"
    } else {
        "external"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "memory_provider_activate_start operation_id={operation_id} profile={profile} target={target}"
        ),
    );
    let result = config_request_for_scope(state, scope, method, &path, Some(body)).await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "memory_provider_activate_{outcome} operation_id={operation_id} profile={profile} target={target}"
        ),
    );
    let value = result?;
    if value.get("ok").and_then(Value::as_bool) != Some(true)
        || value.get("active").and_then(Value::as_str) != Some(provider.as_str())
    {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(serde_json::json!({ "ok": true, "active": provider }))
}

async fn journey_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    profile: &str,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let (method, path, body) = match operation {
        "journey.graph" if payload == &serde_json::json!({}) => {
            (Method::GET, "/api/learning/graph".to_owned(), None)
        }
        "journey.node" => {
            let id = field(payload, "id", 500)?;
            let mut url = Url::parse("http://localhost/api/learning/node")
                .map_err(|_| DesktopFailure::operation_failed())?;
            url.query_pairs_mut().append_pair("id", id);
            (
                Method::GET,
                format!("{}?{}", url.path(), url.query().unwrap_or_default()),
                None,
            )
        }
        "journey.edit" => {
            let id = field(payload, "id", 500)?;
            let content = payload
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::invalid_input)?;
            if content.trim().is_empty() || content.len() > 256 * 1024 || content.contains('\0') {
                return Err(DesktopFailure::invalid_input());
            }
            (
                Method::PUT,
                "/api/learning/node".to_owned(),
                Some(serde_json::json!({"id": id, "content": content})),
            )
        }
        "journey.delete" => {
            let id = field(payload, "id", 500)?;
            (
                Method::DELETE,
                "/api/learning/node".to_owned(),
                Some(serde_json::json!({"id": id})),
            )
        }
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let operation_id = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("{operation}_start operation_id={operation_id} profile={profile}"),
    );
    let result = config_request_for_scope(state, scope, method, &path, body).await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("{operation}_{outcome} operation_id={operation_id} profile={profile}"),
    );
    result
}

async fn update_mcp_server(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    // Keep the profile fixed across both requests. The upstream API only offers a
    // whole-map replace, so read the raw map here rather than rebuilding it from
    // the redacted summaries exposed to the UI.
    let raw = config_request_for_scope(state, scope, Method::GET, "/api/config/raw", None).await?;
    let yaml = raw
        .get("yaml")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let config: Value =
        serde_yaml::from_str(yaml).map_err(|_| DesktopFailure::operation_failed())?;
    let servers = prepare_mcp_update(&config, payload)?;
    config_request_for_scope(
        state,
        scope,
        Method::PUT,
        "/api/mcp/servers",
        Some(serde_json::json!({ "servers": servers })),
    )
    .await
}

fn prepare_mcp_update(config: &Value, payload: &Value) -> Result<Value, DesktopFailure> {
    let name = field(payload, "name", 200)?;
    let url = payload
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let command = payload
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if (url.is_empty() == command.is_empty()) || url.len() > 2048 || command.len() > 2048 {
        return Err(DesktopFailure::invalid_input());
    }
    let args = payload.get("args").and_then(Value::as_array);
    if command.is_empty() && args.is_some_and(|values| !values.is_empty()) {
        return Err(DesktopFailure::invalid_input());
    }
    if args.is_some_and(|values| {
        values.iter().any(|value| {
            value
                .as_str()
                .is_none_or(|arg| arg.len() > 2048 || arg.chars().any(char::is_control))
        })
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut servers = config
        .get("mcp_servers")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(DesktopFailure::operation_failed)?;
    let server = servers
        .get_mut(name)
        .and_then(Value::as_object_mut)
        .ok_or_else(DesktopFailure::invalid_input)?;
    // A transport switch needs different auth and environment settings. Keep this
    // edit scoped to the existing transport so those settings remain intact.
    if server.contains_key("url") != !url.is_empty() {
        return Err(DesktopFailure::invalid_input());
    }
    if !url.is_empty() {
        server.insert("url".into(), Value::String(url.into()));
    } else {
        server.insert("command".into(), Value::String(command.into()));
        server.insert(
            "args".into(),
            Value::Array(args.cloned().unwrap_or_default()),
        );
    }
    Ok(Value::Object(servers))
}

#[cfg(test)]
#[path = "tests/extensions.rs"]
mod tests;

fn upstream_request_target(
    port: u16,
    operation: &str,
    payload: &Value,
) -> Result<(Method, Url), DesktopFailure> {
    let (method, route, path_key, query_key) = match operation {
        "skills.list" => (Method::GET, "/api/skills", None, None),
        "skills.content" => (Method::GET, "/api/skills/content", None, Some("name")),
        "skills.create" => (Method::POST, "/api/skills", None, None),
        "skills.edit" => (Method::PUT, "/api/skills/content", None, None),
        "skills.toggle" => (Method::PUT, "/api/skills/toggle", None, None),
        "skills.lock" => (Method::PUT, "/api/skills/lock", None, None),
        "skills.official" => (Method::GET, "/api/skills/hub/official", None, None),
        "skills.sources" => (Method::GET, "/api/skills/hub/sources", None, None),
        "skills.search" => (Method::GET, "/api/skills/hub/search", None, Some("q")),
        "skills.preview" => (
            Method::GET,
            "/api/skills/hub/preview",
            None,
            Some("identifier"),
        ),
        "skills.scan" => (
            Method::GET,
            "/api/skills/hub/scan",
            None,
            Some("identifier"),
        ),
        "skills.install" => (Method::POST, "/api/skills/hub/install", None, None),
        "skills.uninstall" => (Method::POST, "/api/skills/hub/uninstall", None, None),
        "skills.update" => (Method::POST, "/api/skills/hub/update", None, None),
        "toolsets.config" => (Method::GET, "/api/tools/toolsets", Some("name"), None),
        "toolsets.provider" => (Method::PUT, "/api/tools/toolsets", Some("name"), None),
        "toolsets.env" => (Method::PUT, "/api/tools/toolsets", Some("name"), None),
        "mcp.list" => (Method::GET, "/api/mcp/servers", None, None),
        "mcp.add" => (Method::POST, "/api/mcp/servers", None, None),
        "mcp.remove" => (Method::DELETE, "/api/mcp/servers", Some("name"), None),
        "mcp.test" => (Method::POST, "/api/mcp/servers", Some("name"), None),
        "mcp.toggle" => (Method::PUT, "/api/mcp/servers", Some("name"), None),
        "mcp.auth" => (Method::POST, "/api/mcp/servers", Some("name"), None),
        "mcp.auth.status" => (Method::GET, "/api/mcp/oauth/flows", Some("flow_id"), None),
        "mcp.auth.cancel" => (
            Method::DELETE,
            "/api/mcp/oauth/flows",
            Some("flow_id"),
            None,
        ),
        "mcp.catalog" => (Method::GET, "/api/mcp/catalog", None, None),
        "mcp.install" => (Method::POST, "/api/mcp/catalog/install", None, None),
        "actions.status" => (Method::GET, "/api/actions", Some("name"), None),
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}{route}"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if let Some(key) = path_key {
        let name = field(&payload, key, 200)?;
        if operation == "actions.status"
            && name != "skills-update"
            && !name.starts_with("skills-install-")
            && !name.starts_with("skills-uninstall-")
            && !name.starts_with("mcp-install-")
        {
            return Err(DesktopFailure::invalid_input());
        }
        url.path_segments_mut()
            .map_err(|_| DesktopFailure::operation_failed())?
            .push(name);
        if operation == "mcp.test" {
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::operation_failed())?
                .push("test");
        } else if operation == "mcp.toggle" {
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::operation_failed())?
                .push("enabled");
        } else if operation == "mcp.auth" {
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::operation_failed())?
                .push("auth");
        } else if operation == "actions.status" {
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::operation_failed())?
                .push("status");
        } else if operation == "toolsets.config" {
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::operation_failed())?
                .push("config");
        } else if operation == "toolsets.provider" {
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::operation_failed())?
                .push("provider");
        } else if operation == "toolsets.env" {
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::operation_failed())?
                .push("env");
        }
    }
    if let Some(key) = query_key {
        let value = field(&payload, key, 500)?;
        url.query_pairs_mut().append_pair(key, value);
        if operation == "skills.search" {
            if let Some(source) = payload.get("source").and_then(Value::as_str) {
                if source.len() <= 80 {
                    url.query_pairs_mut().append_pair("source", source);
                }
            }
        }
    }
    Ok((method, url))
}

async fn upstream_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let (method, url) = upstream_request_target(port, operation, payload)?;
    let mut request = super::local_http::client()?
        .request(method.clone(), url)
        .timeout(Duration::from_secs(45))
        .header(auth_header, token);
    if method != Method::GET && method != Method::DELETE {
        request = request.json(&payload);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !response.status().is_success() {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "profile_extension_http_failed profile={} operation={operation} status={}",
                scope.profile,
                response.status().as_u16()
            ),
        );
        // Upstream errors can contain server configuration or credentials.
        return Err(DesktopFailure::operation_failed());
    }
    if response
        .content_length()
        .is_some_and(|size| size > 4 * 1024 * 1024)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(DesktopFailure::operation_failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut value: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    if operation == "actions.status" {
        // Action logs may include command arguments or third-party output.
        if let Some(object) = value.as_object_mut() {
            object.remove("lines");
        }
    }
    scope.ensure_current(state).await?;
    Ok(value)
}
