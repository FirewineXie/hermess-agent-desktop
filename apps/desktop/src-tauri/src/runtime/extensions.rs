use super::{
    config::config_request_for_scope, jobs, mcp_registry, modelscope, modelscope_mcp,
    profile_scope::ResolvedProfileScope, BackendState,
};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::Value;
use std::time::Duration;
use tauri::State;

fn field<'a>(body: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let value = body.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

#[tauri::command]
pub async fn extension_request(
    state: State<'_, BackendState>,
    profile: String,
    operation: String,
    payload: Value,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    if operation.starts_with("jobs.") {
        return jobs::request(&state, &scope, &operation, &payload).await;
    }
    match operation.as_str() {
        "mcp.update" => return update_mcp_server(&state, &scope, &payload).await,
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

async fn upstream_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let (method, route, path_key, query_key) = match operation {
        "skills.list" => (Method::GET, "/api/skills", None, None),
        "skills.content" => (Method::GET, "/api/skills/content", None, Some("name")),
        "skills.create" => (Method::POST, "/api/skills", None, None),
        "skills.edit" => (Method::PUT, "/api/skills/content", None, None),
        "skills.toggle" => (Method::PUT, "/api/skills/toggle", None, None),
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
        "mcp.list" => (Method::GET, "/api/mcp/servers", None, None),
        "mcp.add" => (Method::POST, "/api/mcp/servers", None, None),
        "mcp.remove" => (Method::DELETE, "/api/mcp/servers", Some("name"), None),
        "mcp.test" => (Method::POST, "/api/mcp/servers", Some("name"), None),
        "mcp.toggle" => (Method::PUT, "/api/mcp/servers", Some("name"), None),
        "mcp.auth" => (Method::POST, "/api/mcp/servers", Some("name"), None),
        "mcp.auth.status" => (Method::GET, "/api/mcp/oauth/flows", Some("flow_id"), None),
        "mcp.catalog" => (Method::GET, "/api/mcp/catalog", None, None),
        "mcp.install" => (Method::POST, "/api/mcp/catalog/install", None, None),
        "actions.status" => (Method::GET, "/api/actions", Some("name"), None),
        _ => return Err(DesktopFailure::invalid_input()),
    };
    scope.ensure_current(state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
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
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut request = client
        .request(method.clone(), url)
        .header(auth_header, token);
    if method != Method::GET && method != Method::DELETE {
        request = request.json(&payload);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !response.status().is_success() {
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
