//! Read-only MCP Registry discovery and guarded installation through the owned Hermes runtime.

use crate::errors::DesktopFailure;
use reqwest::Url;
use serde_json::{json, Value};
use std::time::Duration;

const BASE: &str = "https://registry.modelcontextprotocol.io";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;

fn valid_name(name: &str) -> bool {
    let Some((publisher, server)) = name.split_once('/') else {
        return false;
    };
    !publisher.is_empty()
        && !server.is_empty()
        && !publisher.starts_with('.')
        && !server.starts_with('.')
        && !name.contains("..")
        && name.len() <= 200
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'/'))
        && !server.contains('/')
}

fn client() -> Result<reqwest::Client, DesktopFailure> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DesktopFailure::operation_failed())
}

async fn fetch(url: Url) -> Result<Value, DesktopFailure> {
    let mut response = client()?
        .get(url)
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if body.len() + chunk.len() > MAX_RESPONSE {
            return Err(DesktopFailure::operation_failed());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| DesktopFailure::operation_failed())
}

fn url(path: &str) -> Result<Url, DesktopFailure> {
    Url::parse(BASE)
        .and_then(|base| base.join(path))
        .map_err(|_| DesktopFailure::operation_failed())
}

fn installable_remote(server: &Value) -> Option<&str> {
    server
        .get("remotes")?
        .as_array()?
        .iter()
        .find_map(|remote| {
            if remote.get("type")?.as_str()? != "streamable-http"
                || remote
                    .get("headers")
                    .is_some_and(|headers| headers.as_array().is_none_or(|items| !items.is_empty()))
                || remote.get("variables").is_some_and(|variables| {
                    variables.as_array().is_none_or(|items| !items.is_empty())
                })
            {
                return None;
            }
            let address = remote.get("url")?.as_str()?;
            if address.contains('{') || address.contains('}') {
                return None;
            }
            let parsed = Url::parse(address).ok()?;
            (parsed.scheme() == "https"
                && parsed.host_str().is_some()
                && parsed.username().is_empty()
                && parsed.password().is_none())
            .then_some(address)
        })
}

fn safe_web_url(address: &str) -> Option<&str> {
    let parsed = Url::parse(address).ok()?;
    (parsed.scheme() == "https" && parsed.host_str().is_some()).then_some(address)
}

fn entry(response: &Value) -> Option<Value> {
    let server = response.get("server")?;
    let name = server.get("name")?.as_str()?;
    if !valid_name(name) {
        return None;
    }
    let version = server.get("version")?.as_str()?;
    let remote = installable_remote(server);
    let manual_url = server.pointer("/remotes/0/url").and_then(Value::as_str);
    let package = server.pointer("/packages/0");
    let package_hint = package.and_then(|item| {
        Some(format!(
            "{}: {}",
            item.get("registryType")?.as_str()?,
            item.get("identifier")?.as_str()?
        ))
    });
    Some(json!({
        "identifier": name,
        "name": server.get("title").and_then(Value::as_str).unwrap_or(name),
        "description": server.get("description").and_then(Value::as_str).unwrap_or(""),
        "source": "registry",
        "version": version,
        "repository": server.pointer("/repository/url").or_else(|| server.get("websiteUrl"))
            .and_then(Value::as_str).and_then(safe_web_url),
        "transport": if remote.is_some() || manual_url.is_some() { "http" } else { "stdio" },
        "url": remote,
        "manual_url": manual_url,
        "package_hint": package_hint,
        "installable": remote.is_some(),
        "installed": false,
        "enabled": false,
    }))
}

pub(super) async fn search(query: &str) -> Result<Value, DesktopFailure> {
    if query.len() > 500 || query.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut address = url("/v0.1/servers")?;
    address
        .query_pairs_mut()
        .append_pair("version", "latest")
        .append_pair("limit", "20");
    if !query.trim().is_empty() {
        address
            .query_pairs_mut()
            .append_pair("search", query.trim());
    }
    let response = fetch(address).await?;
    let entries = response
        .get("servers")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?
        .iter()
        .filter_map(entry)
        .collect::<Vec<_>>();
    Ok(json!({"entries": entries}))
}

fn detail_url(name: &str) -> Result<Url, DesktopFailure> {
    if !valid_name(name) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut address = url("/v0.1/servers")?;
    address
        .path_segments_mut()
        .map_err(|_| DesktopFailure::operation_failed())?
        .push(name)
        .extend(["versions", "latest"]);
    Ok(address)
}

pub(super) async fn preview(name: &str) -> Result<Value, DesktopFailure> {
    let response = fetch(detail_url(name)?).await?;
    entry(&response).ok_or_else(DesktopFailure::operation_failed)
}

#[cfg(test)]
#[path = "tests/mcp_registry.rs"]
mod tests;
