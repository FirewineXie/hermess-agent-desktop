//! Public ModelScope MCP plaza search and preview. Account-owned hosting is not managed here.

use crate::errors::DesktopFailure;
use reqwest::Url;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

const BASE: &str = "https://www.modelscope.cn";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;

fn server_id(identifier: &str) -> Result<&str, DesktopFailure> {
    let id = identifier
        .strip_prefix("modelscope-mcp:")
        .ok_or_else(DesktopFailure::invalid_input)?;
    let Some((owner, server)) = id.split_once('/') else {
        return Err(DesktopFailure::invalid_input());
    };
    let owner = owner.strip_prefix('@').unwrap_or(owner);
    if owner.is_empty()
        || server.is_empty()
        || id.len() > 200
        || id.contains("..")
        || server.contains('/')
        || [owner, server].iter().any(|part| {
            !part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(id)
}

fn install_name(id: &str) -> String {
    let slug = id
        .trim_start_matches('@')
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() {
                byte.to_ascii_lowercase() as char
            } else {
                '-'
            }
        })
        .collect::<String>();
    let digest = Sha256::digest(id.as_bytes());
    format!(
        "ms-{}-{:02x}{:02x}{:02x}{:02x}",
        &slug[..slug.len().min(48)],
        digest[0],
        digest[1],
        digest[2],
        digest[3]
    )
}

fn client() -> Result<reqwest::Client, DesktopFailure> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DesktopFailure::operation_failed())
}

fn endpoint() -> Result<Url, DesktopFailure> {
    Url::parse(&format!("{BASE}/openapi/v1/mcp/servers"))
        .map_err(|_| DesktopFailure::operation_failed())
}

async fn fetch(request: reqwest::RequestBuilder) -> Result<Value, DesktopFailure> {
    let mut response = request
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
    let response: Value =
        serde_json::from_slice(&body).map_err(|_| DesktopFailure::operation_failed())?;
    if response.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(response)
}

fn safe_web_url(address: &str) -> Option<&str> {
    let parsed = Url::parse(address).ok()?;
    (parsed.scheme() == "https" && parsed.host_str().is_some() && parsed.username().is_empty())
        .then_some(address)
}

fn direct_remote(data: &Value) -> Option<&str> {
    data.get("server_config")?
        .as_array()?
        .iter()
        .find_map(|config| {
            let servers = config.get("mcpServers")?.as_object()?;
            if servers.len() != 1 {
                return None;
            }
            servers.values().find_map(|server| {
                if server.get("command").is_some()
                    || server.get("env").is_some()
                    || server.get("headers").is_some()
                    || server.get("auth").is_some()
                {
                    return None;
                }
                let address = server.get("url")?.as_str()?;
                if address.contains('{') || address.contains('}') {
                    return None;
                }
                safe_web_url(address)
            })
        })
}

fn entry(data: &Value) -> Option<Value> {
    let id = data.get("id")?.as_str()?;
    let identifier = format!("modelscope-mcp:{id}");
    server_id(&identifier).ok()?;
    let url = direct_remote(data);
    let mut catalog_url = Url::parse(BASE).ok()?;
    catalog_url
        .path_segments_mut()
        .ok()?
        .extend(["mcp", "servers"])
        .extend(id.split('/'));
    let config = data
        .get("server_config")
        .and_then(Value::as_array)
        .and_then(|list| list.first());
    let command_hint = config
        .and_then(|value| value.get("mcpServers"))
        .and_then(Value::as_object)
        .and_then(|servers| servers.values().next())
        .and_then(|server| {
            let command = server.get("command")?.as_str()?;
            let args = server.get("args").and_then(Value::as_array);
            let args = args
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>();
            Some(format!("{} {}", command, args.join(" ")).trim().to_owned())
        });
    let readme_excerpt = data
        .get("readme")
        .and_then(Value::as_str)
        .map(|content| content.chars().take(6000).collect::<String>());
    Some(json!({
        "identifier": identifier,
        "install_name": install_name(id),
        "name": data.get("name").and_then(Value::as_str).filter(|name| !name.is_empty()).unwrap_or(id),
        "description": data.get("description").and_then(Value::as_str).unwrap_or(""),
        "source": "modelscope",
        "transport": if url.is_some() { "http" } else { "manual" },
        "url": url,
        "manual_url": data.pointer("/operational_urls/0/url").and_then(Value::as_str),
        "package_hint": command_hint,
        "readme_excerpt": readme_excerpt,
        "repository": data.get("source_url").and_then(Value::as_str).and_then(safe_web_url),
        "catalog_url": catalog_url.as_str(),
        "installable": url.is_some(),
        "installed": false,
        "enabled": false,
    }))
}

pub(super) async fn search(query: &str) -> Result<Value, DesktopFailure> {
    if query.len() > 500 || query.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let response = fetch(client()?.put(endpoint()?).json(&json!({
        "search": query.trim(), "page_number": 1, "page_size": 20
    })))
    .await?;
    let entries = response
        .pointer("/data/mcp_server_list")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?
        .iter()
        .filter_map(entry)
        .collect::<Vec<_>>();
    Ok(json!({"entries": entries}))
}

fn detail_url(identifier: &str) -> Result<Url, DesktopFailure> {
    let id = server_id(identifier)?;
    let mut address = endpoint()?;
    address
        .path_segments_mut()
        .map_err(|_| DesktopFailure::operation_failed())?
        .extend(id.split('/'));
    Ok(address)
}

pub(super) async fn preview(identifier: &str) -> Result<Value, DesktopFailure> {
    let id = server_id(identifier)?;
    let response = fetch(client()?.get(detail_url(identifier)?)).await?;
    let data = response
        .get("data")
        .ok_or_else(DesktopFailure::operation_failed)?;
    if data.get("id").and_then(Value::as_str) != Some(id) {
        return Err(DesktopFailure::operation_failed());
    }
    entry(data).ok_or_else(DesktopFailure::operation_failed)
}

#[cfg(test)]
#[path = "tests/modelscope_mcp.rs"]
mod tests;
