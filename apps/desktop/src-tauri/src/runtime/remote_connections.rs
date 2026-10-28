use crate::errors::DesktopFailure;
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, Url};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::{timeout, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectionProbe {
    pub status: &'static str,
    pub base_url: String,
    pub version: Option<String>,
    pub profile_count: Option<usize>,
}

pub(super) fn normalized_remote_url(raw: &str) -> Result<Url, DesktopFailure> {
    let input = raw.trim();
    if input.is_empty() || input.len() > 2048 || input.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let with_scheme = if input.contains("://") {
        input.to_owned()
    } else {
        format!("http://{input}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|_| DesktopFailure::invalid_input())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(DesktopFailure::invalid_input());
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(if path.is_empty() { "/" } else { &path });
    Ok(url)
}

pub(super) fn is_loopback_url(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    )
}

pub(super) fn endpoint_url(base: &Url, suffix: &str) -> Result<Url, DesktopFailure> {
    let mut url = base.clone();
    url.path_segments_mut()
        .map_err(|_| DesktopFailure::invalid_input())?
        .pop_if_empty()
        .extend(suffix.split('/'));
    Ok(url)
}

pub(super) fn remote_websocket_url(base: &Url, token: &str) -> Result<Url, DesktopFailure> {
    let mut url = endpoint_url(base, "api/ws")?;
    url.set_scheme(if base.scheme() == "https" {
        "wss"
    } else {
        "ws"
    })
    .map_err(|_| DesktopFailure::invalid_input())?;
    url.query_pairs_mut().append_pair("token", token);
    Ok(url)
}

fn probe_result(
    status: &'static str,
    base: &Url,
    version: Option<String>,
) -> RemoteConnectionProbe {
    RemoteConnectionProbe {
        status,
        base_url: base.as_str().trim_end_matches('/').to_owned(),
        version,
        profile_count: None,
    }
}

async fn bounded_json(client: &Client, url: Url, token: Option<&str>) -> Result<(u16, Value), ()> {
    let mut request = client.get(url);
    if let Some(token) = token {
        request = request.header("X-Hermes-Session-Token", token);
    }
    let mut response = request.send().await.map_err(|_| ())?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len() + chunk.len() > 128 * 1024 {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    Ok((status, value))
}

async fn probe_token_websocket(base: &Url, token: &str) -> bool {
    let Ok(url) = remote_websocket_url(base, token) else {
        return false;
    };
    let Ok(Ok((mut socket, _))) =
        timeout(Duration::from_secs(8), connect_async(url.as_str())).await
    else {
        return false;
    };
    let ping = json!({"jsonrpc":"2.0","id":1,"method":"ping","params":{}});
    if socket
        .send(Message::Text(ping.to_string().into()))
        .await
        .is_err()
    {
        return false;
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while let Ok(Some(Ok(frame))) = timeout(
        deadline.saturating_duration_since(Instant::now()),
        socket.next(),
    )
    .await
    {
        if let Message::Text(text) = frame {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if value.get("id").and_then(Value::as_i64) == Some(1) {
                    return value.pointer("/result/pong").and_then(Value::as_bool) == Some(true);
                }
            }
        }
    }
    false
}

#[tauri::command]
pub async fn test_remote_url_connection(
    raw_url: String,
    token: String,
) -> Result<RemoteConnectionProbe, DesktopFailure> {
    let base = normalized_remote_url(&raw_url)?;
    if token.is_empty()
        || token.len() > 2048
        || !token.is_ascii()
        || token.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut builder = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(8));
    if is_loopback_url(&base) {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let Ok((status_code, status)) =
        bounded_json(&client, endpoint_url(&base, "api/status")?, Some(&token)).await
    else {
        return Ok(probe_result("status_unreachable", &base, None));
    };
    if status_code != 200 {
        return Ok(probe_result("status_unreachable", &base, None));
    }
    let version = status
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if status.get("auth_required").and_then(Value::as_bool) == Some(true) {
        return Ok(probe_result("oauth_required", &base, version));
    }
    let Ok((profiles_code, profiles)) =
        bounded_json(&client, endpoint_url(&base, "api/profiles")?, Some(&token)).await
    else {
        return Ok(probe_result("http_unreachable", &base, version));
    };
    if profiles_code == 401 || profiles_code == 403 {
        return Ok(probe_result("auth_rejected", &base, version));
    }
    if profiles_code != 200 {
        return Ok(probe_result("http_unreachable", &base, version));
    }
    let Some(profile_count) = profiles
        .get("profiles")
        .and_then(Value::as_array)
        .map(Vec::len)
    else {
        return Ok(probe_result("invalid_response", &base, version));
    };
    if !probe_token_websocket(&base, &token).await {
        return Ok(probe_result("ws_failed", &base, version));
    }
    Ok(RemoteConnectionProbe {
        status: "ready",
        base_url: base.as_str().trim_end_matches('/').to_owned(),
        version,
        profile_count: Some(profile_count),
    })
}

#[cfg(test)]
#[path = "tests/remote_connections.rs"]
mod tests;
