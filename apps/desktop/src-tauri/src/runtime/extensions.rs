use super::BackendState;
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
    operation: String,
    payload: Value,
) -> Result<Value, DesktopFailure> {
    let (method, route, path_key, query_key) = match operation.as_str() {
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
    let (port, token) = state.local_endpoint().await?;
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
        .header("X-Hermes-Session-Token", token);
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
    Ok(value)
}
