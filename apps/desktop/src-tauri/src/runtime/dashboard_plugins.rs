use super::{profile_scope::ResolvedProfileScope, BackendState};
use crate::{diagnostics::append_client_event, errors::DesktopFailure};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use reqwest::{Method, Url};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};
use uuid::Uuid;

const MAX_RESPONSE: usize = 16 * 1024 * 1024;
const MAX_REQUEST: usize = 20 * 1024 * 1024;
const MAX_RESPONSE_HEADER_VALUE: usize = 1024;
const EXCLUDED_ACCOUNT_PROVIDER: &str = "nous";

#[derive(Default)]
pub struct DashboardPluginSockets(Mutex<HashMap<String, SocketEntry>>);

struct SocketEntry {
    profile: String,
    sender: mpsc::UnboundedSender<SocketCommand>,
}

enum SocketCommand {
    Text(String),
    Binary(Vec<u8>),
    Close,
}

#[derive(Clone, Serialize)]
struct DashboardPluginSocketEvent {
    subscription: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    binary_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

fn valid_plugin_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value.split('/').count() <= 2
        && value.split('/').all(|part| {
            !part.is_empty()
                && part.len() <= 100
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
}

fn valid_asset_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && !value.starts_with('/')
        && !value.contains("..")
        && !value.contains('\\')
        && !value.contains('#')
        && !value.contains('\0')
}

fn valid_tab_path(value: &str) -> bool {
    value.starts_with('/')
        && value.len() <= 160
        && !value.contains("..")
        && !value.contains('\\')
        && !value.contains('#')
        && !value.contains('?')
        && !value.contains('\0')
}

fn safe_manifest(row: &Value) -> Option<Value> {
    let name = row.get("name")?.as_str()?.trim();
    let label = row.get("label")?.as_str()?.trim();
    let entry = row.get("entry")?.as_str()?.trim();
    let tab = row.get("tab")?.as_object()?;
    let path = tab.get("path")?.as_str()?.trim();
    if !valid_plugin_name(name)
        || label.is_empty()
        || label.len() > 160
        || !valid_asset_path(entry)
        || !valid_tab_path(path)
    {
        return None;
    }
    let text = |key: &str, max: usize| {
        row.get(key)
            .and_then(Value::as_str)
            .filter(|value| value.len() <= max && !value.chars().any(char::is_control))
            .unwrap_or("")
    };
    let position = tab
        .get("position")
        .and_then(Value::as_str)
        .filter(|value| value.len() <= 160 && !value.chars().any(char::is_control));
    let override_path = tab
        .get("override")
        .and_then(Value::as_str)
        .filter(|value| valid_tab_path(value));
    let css = row
        .get("css")
        .and_then(Value::as_str)
        .filter(|value| valid_asset_path(value));
    let slots: Vec<&str> = row
        .get("slots")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= 80 && !value.chars().any(char::is_control)
        })
        .take(32)
        .collect();
    Some(json!({
        "name": name,
        "label": label,
        "description": text("description", 1000),
        "icon": text("icon", 80),
        "version": text("version", 80),
        "tab": {
            "path": path,
            "position": position,
            "override": override_path,
            "hidden": tab.get("hidden").and_then(Value::as_bool).unwrap_or(false),
        },
        "slots": slots,
        "entry": entry,
        "css": css,
        "integrity": row.get("integrity").and_then(Value::as_str)
            .filter(|value| value.len() <= 256 && value.starts_with("sha")),
        "has_api": row.get("has_api").and_then(Value::as_bool).unwrap_or(false),
        "source": text("source", 160),
    }))
}

fn plugin_api_url(port: u16, path: &str) -> Result<Url, DesktopFailure> {
    if path.len() > 2048
        || !path.starts_with("/api/plugins/")
        || path.contains("..")
        || path.contains('\\')
        || path.contains('#')
        || path.contains('\0')
    {
        return Err(DesktopFailure::invalid_input());
    }
    let url = Url::parse(&format!("http://127.0.0.1:{port}{path}"))
        .map_err(|_| DesktopFailure::invalid_input())?;
    let plugin = url
        .path()
        .strip_prefix("/api/plugins/")
        .and_then(|rest| rest.split('/').next())
        .filter(|name| valid_plugin_name(name))
        .ok_or_else(DesktopFailure::invalid_input)?;
    if plugin.is_empty() || url.host_str() != Some("127.0.0.1") {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(url)
}

fn dashboard_api_allowed(method: &Method, path: &str) -> bool {
    let parts = path.trim_matches('/').split('/').collect::<Vec<_>>();
    let exact = |expected: &str, allowed: &[Method]| {
        path == expected && allowed.iter().any(|candidate| candidate == method)
    };
    if exact("/api/status", &[Method::GET])
        || exact("/api/auth/me", &[Method::GET])
        || exact("/api/sessions", &[Method::GET])
        || exact("/api/sessions/empty/count", &[Method::GET])
        || exact("/api/sessions/empty", &[Method::DELETE])
        || exact("/api/sessions/bulk-delete", &[Method::POST])
        || exact("/api/sessions/stats", &[Method::GET])
        || exact("/api/sessions/prune", &[Method::POST])
        || exact("/api/sessions/import", &[Method::POST])
        || exact("/api/chat/workspaces", &[Method::GET])
        || exact("/api/files", &[Method::GET, Method::DELETE])
        || exact("/api/files/read", &[Method::GET])
        || exact("/api/files/upload-stream", &[Method::POST])
        || exact("/api/files/mkdir", &[Method::POST])
        || exact("/api/logs", &[Method::GET])
        || exact("/api/analytics/usage", &[Method::GET])
        || exact("/api/analytics/models", &[Method::GET])
        || exact("/api/config", &[Method::GET, Method::PUT])
        || exact("/api/config/defaults", &[Method::GET])
        || exact("/api/config/schema", &[Method::GET])
        || exact("/api/config/raw", &[Method::GET, Method::PUT])
        || exact("/api/model/info", &[Method::GET])
        || exact("/api/model/options", &[Method::GET])
        || exact("/api/model/auxiliary", &[Method::GET])
        || exact("/api/model/moa", &[Method::GET, Method::PUT])
        || exact("/api/model/set", &[Method::POST])
        || exact("/api/local-models/status", &[Method::GET])
        || exact("/api/local-models/hardware", &[Method::GET])
        || exact("/api/local-models/catalog", &[Method::GET])
        || exact("/api/local-models/runtime/install", &[Method::POST])
        || exact("/api/local-models/download", &[Method::POST])
        || exact("/api/local-models/download/pause", &[Method::POST])
        || exact("/api/local-models/download/resume", &[Method::POST])
        || exact("/api/local-models/quickstart", &[Method::POST])
        || exact("/api/local-models/server", &[Method::POST])
        || exact("/api/local-models/eject", &[Method::POST])
        || exact("/api/local-models/activate", &[Method::POST])
        || exact("/api/local-models/jobs", &[Method::GET])
        || exact("/api/local-models/search", &[Method::GET])
        || exact("/api/local-models/search/files", &[Method::GET])
        || exact("/api/local-models/download-browsed", &[Method::POST])
        || exact("/api/local-models/sideload", &[Method::POST])
        || exact("/api/shared-metrics/consent", &[Method::GET, Method::PUT])
        || exact("/api/env", &[Method::GET, Method::PUT, Method::DELETE])
        || exact("/api/env/reveal", &[Method::POST])
        || exact("/api/profiles", &[Method::GET, Method::POST])
        || exact("/api/profiles/active", &[Method::GET, Method::POST])
        || exact("/api/cron/jobs", &[Method::GET, Method::POST])
        || exact("/api/cron/delivery-targets", &[Method::GET])
        || exact("/api/cron/blueprints", &[Method::GET])
        || exact("/api/cron/blueprints/instantiate", &[Method::POST])
        || exact("/api/skills", &[Method::GET, Method::POST])
        || exact("/api/skills/content", &[Method::GET, Method::PUT])
        || exact("/api/skills/toggle", &[Method::PUT])
        || exact("/api/skills/hub/search", &[Method::GET])
        || exact("/api/skills/hub/scan", &[Method::GET])
        || exact("/api/skills/hub/install", &[Method::POST])
        || exact("/api/skills/hub/uninstall", &[Method::POST])
        || exact("/api/skills/hub/update", &[Method::POST])
        || exact("/api/skills/hub/sources", &[Method::GET])
        || exact("/api/skills/hub/preview", &[Method::GET])
        || exact("/api/tools/toolsets", &[Method::GET])
        || exact("/api/providers/oauth", &[Method::GET])
        || exact("/api/dashboard/plugins", &[Method::GET])
        || exact("/api/dashboard/plugins/rescan", &[Method::GET])
        || exact("/api/dashboard/plugins/hub", &[Method::GET])
        || exact("/api/dashboard/plugins/catalog", &[Method::GET])
        || exact(
            "/api/dashboard/plugins/auto-update",
            &[Method::GET, Method::PUT],
        )
        || exact("/api/dashboard/agent-plugins/update-all", &[Method::POST])
        || exact("/api/dashboard/agent-plugins/install", &[Method::POST])
        || exact("/api/dashboard/plugin-providers", &[Method::PUT])
        || exact("/api/dashboard/themes", &[Method::GET])
        || exact("/api/dashboard/theme", &[Method::PUT])
        || exact("/api/dashboard/font", &[Method::GET, Method::PUT])
        || exact("/api/memory/provider", &[Method::PUT])
        || exact("/api/memory", &[Method::GET])
        || exact("/api/memory/reset", &[Method::POST])
        || exact("/api/mcp/servers", &[Method::GET, Method::POST])
        || exact("/api/mcp/catalog", &[Method::GET])
        || exact("/api/mcp/catalog/install", &[Method::POST])
        || exact("/api/messaging/platforms", &[Method::GET])
        || exact("/api/messaging/telegram/onboarding/start", &[Method::POST])
        || exact("/api/messaging/whatsapp/onboarding/start", &[Method::POST])
        || exact("/api/pairing", &[Method::GET])
        || exact("/api/pairing/approve", &[Method::POST])
        || exact("/api/pairing/revoke", &[Method::POST])
        || exact("/api/pairing/clear-pending", &[Method::POST])
        || exact("/api/webhooks", &[Method::GET, Method::POST])
        || exact("/api/webhooks/enable", &[Method::POST])
        || exact("/api/credentials/pool", &[Method::GET, Method::POST])
        || exact("/api/ops/doctor", &[Method::POST])
        || exact("/api/ops/security-audit", &[Method::POST])
        || exact("/api/ops/backup", &[Method::POST])
        || exact("/api/ops/backup/download", &[Method::GET])
        || exact("/api/ops/import", &[Method::POST])
        || exact("/api/ops/import-upload", &[Method::POST])
        || exact(
            "/api/ops/hooks",
            &[Method::GET, Method::POST, Method::DELETE],
        )
        || exact("/api/ops/prompt-size", &[Method::POST])
        || exact("/api/ops/dump", &[Method::POST])
        || exact("/api/ops/config-migrate", &[Method::POST])
        || exact("/api/ops/debug-share", &[Method::POST])
        || exact("/api/ops/checkpoints", &[Method::GET])
        || exact("/api/ops/checkpoints/prune", &[Method::POST])
        || exact("/api/system/stats", &[Method::GET])
        || exact("/api/curator", &[Method::GET])
        || exact("/api/curator/paused", &[Method::PUT])
        || exact("/api/curator/run", &[Method::POST])
    {
        return true;
    }
    match parts.as_slice() {
        ["api", "cron", "jobs", _] => method == Method::PUT || method == Method::DELETE,
        ["api", "cron", "jobs", _, action] => {
            matches!(*action, "pause" | "resume" | "trigger") && method == Method::POST
        }
        ["api", "actions", _, "status"] => method == Method::GET,
        ["api", "sessions", _] => {
            method == Method::GET || method == Method::DELETE || method == Method::PATCH
        }
        ["api", "sessions", _, tail] => match *tail {
            "messages" | "latest-descendant" | "export" | "mutation-snapshot" => {
                method == Method::GET
            }
            _ => false,
        },
        ["api", "profiles", _] => {
            method == Method::GET || method == Method::PATCH || method == Method::DELETE
        }
        ["api", "profiles", _, action] => match *action {
            "description" | "model" | "soul" => method == Method::GET || method == Method::PUT,
            "describe-auto" => method == Method::POST,
            "setup-command" => method == Method::GET,
            _ => false,
        },
        ["api", "tools", "toolsets", _] => method == Method::PUT,
        ["api", "tools", "toolsets", _, action] => match *action {
            "config" => method == Method::GET,
            "provider" | "env" => method == Method::PUT,
            "post-setup" => method == Method::POST,
            _ => false,
        },
        ["api", "local-models", "models", _] => method == Method::DELETE,
        ["api", "local-models", "jobs", _] => method == Method::GET,
        ["api", "providers", "oauth", "sessions", _] => method == Method::DELETE,
        ["api", "providers", "oauth", _] => method == Method::DELETE,
        ["api", "providers", "oauth", _, action] => {
            matches!(*action, "start" | "submit") && method == Method::POST
        }
        ["api", "providers", "oauth", _, "poll", _] => method == Method::GET,
        ["api", "dashboard", "agent-plugins", _] => method == Method::DELETE,
        ["api", "dashboard", "agent-plugins", _, tail] => {
            if matches!(*tail, "enable" | "disable" | "update") {
                method == Method::POST
            } else {
                method == Method::DELETE
            }
        }
        ["api", "dashboard", "agent-plugins", _, _, action] => {
            matches!(*action, "enable" | "disable" | "update") && method == Method::POST
        }
        ["api", "dashboard", "plugins", _, "visibility"]
        | ["api", "dashboard", "plugins", _, _, "visibility"] => method == Method::POST,
        ["api", "mcp", "servers", _] => method == Method::DELETE,
        ["api", "mcp", "servers", _, action] => match *action {
            "auth" | "test" => method == Method::POST,
            "enabled" => method == Method::PUT,
            _ => false,
        },
        ["api", "mcp", "oauth", "flows", _] => method == Method::GET,
        ["api", "messaging", "platforms", _] => method == Method::PUT,
        ["api", "messaging", "platforms", _, "test"] => method == Method::POST,
        ["api", "messaging", platform, "onboarding", _]
            if matches!(*platform, "telegram" | "whatsapp") =>
        {
            method == Method::GET || method == Method::DELETE
        }
        ["api", "messaging", platform, "onboarding", _, "apply"]
            if matches!(*platform, "telegram" | "whatsapp") =>
        {
            method == Method::POST
        }
        ["api", "memory", "providers", _, "config"] => {
            method == Method::GET || method == Method::PUT
        }
        ["api", "memory", "providers", _, "setup"] => method == Method::POST,
        ["api", "credentials", "pool", _, _] => method == Method::DELETE,
        ["api", "webhooks", _] => method == Method::DELETE,
        ["api", "webhooks", _, "enabled"] => method == Method::PUT,
        _ => false,
    }
}

fn dashboard_request_url(
    port: u16,
    method: &Method,
    path: &str,
) -> Result<(Url, String), DesktopFailure> {
    if path.starts_with("/api/plugins/") {
        let url = plugin_api_url(port, path)?;
        let owner = url
            .path()
            .trim_start_matches("/api/plugins/")
            .split('/')
            .next()
            .unwrap_or("")
            .to_owned();
        return Ok((url, owner));
    }
    let unsafe_path = path.len() > 2048
        || !path.starts_with("/api/")
        || path.contains("..")
        || path.to_ascii_lowercase().contains("%2e")
        || path.contains('\\')
        || path.contains('#')
        || path.contains('\0');
    if unsafe_path {
        return Err(DesktopFailure::invalid_input());
    }
    let url = Url::parse(&format!("http://127.0.0.1:{port}{path}"))
        .map_err(|_| DesktopFailure::invalid_input())?;
    if url.host_str() != Some("127.0.0.1") || !dashboard_api_allowed(method, url.path()) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok((url, "core-api".to_owned()))
}

fn excluded_account_request(url: &Url) -> bool {
    let path = url.path().to_ascii_lowercase();
    if !path.starts_with("/api/providers/oauth/") {
        return false;
    }
    // OAuth provider ids are the locked catalog's ASCII slugs. Reject encoded
    // path segments here so an encoded `nous` cannot bypass the product scope.
    if path.contains('%') {
        return true;
    }
    path.split('/').nth(4) == Some(EXCLUDED_ACCOUNT_PROVIDER)
}

fn is_toolset_provider_route(url: &Url) -> bool {
    let segments = url.path().split('/').collect::<Vec<_>>();
    segments.len() == 6
        && segments[1..4] == ["api", "tools", "toolsets"]
        && !segments[4].is_empty()
        && segments[5] == "provider"
}

fn is_excluded_toolset_provider(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value == "nous subscription" || value.starts_with("nous subscription (")
}

fn excluded_toolset_provider_request(url: &Url, payload: &Value) -> Result<bool, DesktopFailure> {
    if !is_toolset_provider_route(url) {
        return Ok(false);
    }
    let body = if let Some(body) = payload.get("body").filter(|value| !value.is_null()) {
        body.clone()
    } else if let Some(encoded) = payload.get("body_base64").and_then(Value::as_str) {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| DesktopFailure::invalid_input())?;
        serde_json::from_slice(&decoded).map_err(|_| DesktopFailure::invalid_input())?
    } else {
        return Ok(false);
    };
    Ok(body
        .get("provider")
        .and_then(Value::as_str)
        .is_some_and(is_excluded_toolset_provider))
}

fn is_managed_nous_toolset_provider(row: &Value) -> bool {
    row.get("requires_nous_auth")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || row
            .get("managed_nous_feature")
            .and_then(Value::as_str)
            .is_some_and(|feature| !feature.is_empty())
}

fn filter_excluded_account_provider(url: &Url, bytes: Vec<u8>) -> Result<Vec<u8>, DesktopFailure> {
    let oauth_catalog = url.path() == "/api/providers/oauth";
    let toolset_config = url.path().starts_with("/api/tools/toolsets/")
        && url.path().ends_with("/config")
        && url.path().split('/').count() == 6;
    if !oauth_catalog && !toolset_config {
        return Ok(bytes);
    }
    let mut value =
        serde_json::from_slice::<Value>(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    let providers = value
        .get_mut("providers")
        .and_then(Value::as_array_mut)
        .ok_or_else(DesktopFailure::operation_failed)?;
    if oauth_catalog {
        providers.retain(|row| {
            row.get("id")
                .and_then(Value::as_str)
                .is_none_or(|id| !id.eq_ignore_ascii_case(EXCLUDED_ACCOUNT_PROVIDER))
        });
    } else {
        let removed = providers
            .iter()
            .filter(|row| is_managed_nous_toolset_provider(row))
            .filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_owned))
            .collect::<Vec<_>>();
        providers.retain(|row| !is_managed_nous_toolset_provider(row));
        if value
            .get("active_provider")
            .and_then(Value::as_str)
            .is_some_and(|active| removed.iter().any(|name| name == active))
        {
            value["active_provider"] = Value::Null;
        }
        for (managed_key, backend_key) in [
            ("search_via_nous", "active_search_backend"),
            ("extract_via_nous", "active_extract_backend"),
        ] {
            if value.get(managed_key).and_then(Value::as_bool) == Some(true) {
                value[managed_key] = Value::Bool(false);
                value[backend_key] = Value::Null;
            }
        }
    }
    serde_json::to_vec(&value).map_err(|_| DesktopFailure::operation_failed())
}

fn request_profile_is_bound(url: &Url, payload: &Value, profile: &str) -> bool {
    let query_profiles = url
        .query_pairs()
        .filter(|(key, _)| key == "profile")
        .map(|(_, value)| value.into_owned())
        .collect::<Vec<_>>();
    let body_profile = payload
        .get("body")
        .and_then(|body| body.get("profile"))
        .and_then(Value::as_str);
    if query_profiles.iter().any(|value| value != profile)
        || body_profile.is_some_and(|value| value != profile)
    {
        return false;
    }
    let path = url.path();
    let scoped = [
        "/api/status",
        "/api/sessions",
        "/api/chat/workspaces",
        "/api/gateway",
        "/api/analytics",
        "/api/cron",
        "/api/skills",
        "/api/tools/toolsets",
        "/api/config",
        "/api/env",
        "/api/mcp",
        "/api/messaging",
        "/api/providers/oauth",
        "/api/model",
        "/api/local-models",
        "/api/pairing",
        "/api/memory",
        "/api/curator",
        "/api/webhooks",
        "/api/ops",
        "/api/logs",
        "/api/credentials",
        "/api/dashboard/plugin-providers",
        "/api/dashboard/theme",
        "/api/dashboard/font",
        "/api/dashboard/plugins",
        "/api/dashboard/agent-plugins",
        "/api/plugins/",
        "/api/shared-metrics",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix));
    !scoped || !query_profiles.is_empty() || body_profile.is_some()
}

fn plugin_ws_request(
    port: u16,
    header: &str,
    credential: &str,
    path: &str,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, DesktopFailure> {
    let mut url = plugin_api_url(port, path)?;
    url.set_scheme("ws")
        .map_err(|_| DesktopFailure::invalid_input())?;
    if header == "X-Hermes-Session-Token" {
        url.query_pairs_mut().append_pair("token", credential);
    }
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if header == "X-Hermes-Gateway-Ticket" {
        request.headers_mut().insert(
            "X-Hermes-Gateway-Ticket",
            HeaderValue::from_str(credential).map_err(|_| DesktopFailure::invalid_input())?,
        );
    }
    Ok(request)
}

fn log_socket(scope: &ResolvedProfileScope, subscription: &str, phase: &str, outcome: &str) {
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "dashboard_plugin_socket subscription={subscription} profile={} phase={phase} outcome={outcome}",
            scope.profile
        ),
    );
}

#[tauri::command]
pub async fn dashboard_plugin_socket_subscribe(
    state: State<'_, BackendState>,
    sockets: State<'_, DashboardPluginSockets>,
    app: AppHandle,
    profile: String,
    subscription: String,
    path: String,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    let (port, header, credential) = scope.http_auth().await?;
    let request = plugin_ws_request(port, header, &credential, &path)?;
    log_socket(&scope, &subscription, "start", "connecting");
    let (socket, _) = timeout(Duration::from_secs(10), connect_async(request))
        .await
        .map_err(|_| {
            log_socket(&scope, &subscription, "finish", "timeout");
            DesktopFailure::connection_lost()
        })?
        .map_err(|_| {
            log_socket(&scope, &subscription, "finish", "rejected");
            DesktopFailure::connection_lost()
        })?;
    scope.ensure_current(&state).await?;
    let (command_sender, mut command_receiver) = mpsc::unbounded_channel();
    if let Some(previous) = sockets.0.lock().await.insert(
        subscription.clone(),
        SocketEntry {
            profile: scope.profile.clone(),
            sender: command_sender,
        },
    ) {
        let _ = previous.sender.send(SocketCommand::Close);
    }
    log_socket(&scope, &subscription, "connected", "ok");
    let task_app = app.clone();
    let task_subscription = subscription.clone();
    let storage = scope.storage.clone();
    let profile = scope.profile.clone();
    tokio::spawn(async move {
        let mut socket = socket;
        let mut reason = "ended";
        loop {
            tokio::select! {
                command = command_receiver.recv() => match command {
                    Some(SocketCommand::Text(data)) => {
                        if socket.send(Message::Text(data.into())).await.is_err() {
                            reason = "write_failed";
                            break;
                        }
                    }
                    Some(SocketCommand::Binary(data)) => {
                        if socket.send(Message::Binary(data.into())).await.is_err() {
                            reason = "write_failed";
                            break;
                        }
                    }
                    Some(SocketCommand::Close) | None => {
                        let _ = socket.close(None).await;
                        break;
                    }
                },
                frame = socket.next() => match frame {
                    Some(Ok(Message::Text(data))) => {
                        if task_app.emit("dashboard-plugin-socket-event", DashboardPluginSocketEvent {
                            subscription: task_subscription.clone(), kind: "message",
                            data: Some(data.to_string()), binary_base64: None, reason: None,
                        }).is_err() { break; }
                    }
                    Some(Ok(Message::Binary(data))) => {
                        if data.len() > MAX_RESPONSE {
                            reason = "invalid_frame";
                            break;
                        }
                        if task_app.emit("dashboard-plugin-socket-event", DashboardPluginSocketEvent {
                            subscription: task_subscription.clone(), kind: "message", data: None,
                            binary_base64: Some(base64::engine::general_purpose::STANDARD.encode(data)), reason: None,
                        }).is_err() { break; }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            reason = "write_failed";
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => { reason = "read_failed"; break; }
                    _ => {}
                }
            }
        }
        let _ = task_app.emit(
            "dashboard-plugin-socket-event",
            DashboardPluginSocketEvent {
                subscription: task_subscription.clone(),
                kind: "closed",
                data: None,
                binary_base64: None,
                reason: Some(reason),
            },
        );
        task_app
            .state::<DashboardPluginSockets>()
            .0
            .lock()
            .await
            .remove(&task_subscription);
        let _ = append_client_event(&storage, &format!(
            "dashboard_plugin_socket subscription={task_subscription} profile={profile} phase=finish outcome={reason}"
        ));
    });
    Ok(())
}

#[tauri::command]
pub async fn dashboard_plugin_socket_send(
    sockets: State<'_, DashboardPluginSockets>,
    profile: String,
    subscription: String,
    data: String,
    binary: bool,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    let command = if binary {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| DesktopFailure::invalid_input())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        SocketCommand::Binary(bytes)
    } else {
        if data.len() > 4 * 1024 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        SocketCommand::Text(data)
    };
    let sockets = sockets.0.lock().await;
    let entry = sockets
        .get(&subscription)
        .filter(|entry| entry.profile == profile)
        .ok_or_else(DesktopFailure::invalid_input)?;
    entry
        .sender
        .send(command)
        .map_err(|_| DesktopFailure::connection_lost())
}

#[tauri::command]
pub async fn dashboard_plugin_socket_unsubscribe(
    sockets: State<'_, DashboardPluginSockets>,
    profile: String,
    subscription: String,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    let mut sockets = sockets.0.lock().await;
    if sockets
        .get(&subscription)
        .is_some_and(|entry| entry.profile != profile)
    {
        return Err(DesktopFailure::invalid_input());
    }
    if let Some(entry) = sockets.remove(&subscription) {
        let _ = entry.sender.send(SocketCommand::Close);
    }
    Ok(())
}

async fn bounded_response(response: reqwest::Response) -> Result<Vec<u8>, DesktopFailure> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err(DesktopFailure::operation_failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn safe_response_headers(headers: &reqwest::header::HeaderMap) -> BTreeMap<String, String> {
    let mut safe = BTreeMap::new();
    for name in [
        reqwest::header::CONTENT_TYPE,
        reqwest::header::CONTENT_DISPOSITION,
    ] {
        let Some(value) = headers
            .get(&name)
            .and_then(|value| value.to_str().ok())
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= MAX_RESPONSE_HEADER_VALUE
                    && !value.chars().any(char::is_control)
            })
        else {
            continue;
        };
        safe.insert(name.as_str().to_owned(), value.to_owned());
    }
    safe
}

fn safe_response_url(url: &Url) -> String {
    let mut safe = format!("http://hermess.local{}", url.path());
    if let Some(query) = url.query() {
        safe.push('?');
        safe.push_str(query);
    }
    safe
}

fn safe_status_text(status: reqwest::StatusCode) -> &'static str {
    status.canonical_reason().unwrap_or("")
}

fn response_was_redirected(requested: &Url, effective: &Url) -> bool {
    requested != effective
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, header, credential) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let client = super::local_http::client()?;
    if operation == "dashboard.plugins.list" {
        let mut list_url = Url::parse(&format!("http://127.0.0.1:{port}/api/dashboard/plugins"))
            .map_err(|_| DesktopFailure::operation_failed())?;
        list_url
            .query_pairs_mut()
            .append_pair("profile", &scope.profile);
        let response = client
            .get(list_url)
            .timeout(Duration::from_secs(210))
            .header(header, credential)
            .send()
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        if !response.status().is_success() {
            return Err(DesktopFailure::operation_failed());
        }
        let bytes = bounded_response(response).await?;
        let rows = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|value| value.as_array().cloned())
            .ok_or_else(DesktopFailure::operation_failed)?;
        scope.ensure_current(state).await?;
        let plugins: Vec<_> = rows.iter().filter_map(safe_manifest).collect();
        if plugins.len() != rows.len() {
            crate::diagnostics::log_client_event(&format!(
                "dashboard_plugin_manifest_invalid profile={} rejected_count={}",
                scope.profile,
                rows.len() - plugins.len()
            ));
        }
        return Ok(json!({
            "plugins": plugins,
            "asset_origin": format!("http://127.0.0.1:{port}"),
        }));
    }
    if operation != "dashboard.plugins.request" {
        return Err(DesktopFailure::invalid_input());
    }
    let path = payload
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .parse::<Method>()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !matches!(
        method,
        Method::GET | Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return Err(DesktopFailure::invalid_input());
    }
    let (url, plugin) = dashboard_request_url(port, &method, path)?;
    if !request_profile_is_bound(&url, payload, &scope.profile) {
        return Err(DesktopFailure::invalid_input());
    }
    if excluded_account_request(&url) {
        return Err(DesktopFailure::invalid_input());
    }
    if excluded_toolset_provider_request(&url, payload)? {
        let _ = append_client_event(
            &scope.storage,
            &format!(
                "dashboard_plugin_request_rejected profile={} plugin={} method={method} reason=managed_nous_toolset_provider",
                scope.profile, plugin
            ),
        );
        return Err(DesktopFailure::invalid_input());
    }
    let operation_id = (method != Method::GET).then(Uuid::new_v4);
    if let Some(id) = operation_id {
        let _ = append_client_event(
            &scope.storage,
            &format!(
            "dashboard_plugin_request_start operation_id={id} profile={} plugin={} method={method}",
            scope.profile, plugin
        ),
        );
    }
    let mut request = client
        .request(method.clone(), url.clone())
        .timeout(Duration::from_secs(210))
        .header(header, credential);
    if let Some(body) = payload.get("body").filter(|value| !value.is_null()) {
        request = request.json(body);
    } else if let Some(encoded) = payload.get("body_base64").and_then(Value::as_str) {
        let body = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| DesktopFailure::invalid_input())?;
        if body.len() > MAX_REQUEST {
            return Err(DesktopFailure::invalid_input());
        }
        let content_type = payload
            .get("content_type")
            .and_then(Value::as_str)
            .filter(|value| {
                !value.is_empty() && value.len() <= 160 && !value.chars().any(char::is_control)
            })
            .ok_or_else(DesktopFailure::invalid_input)?;
        request = request
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(body);
    }
    let result = async {
        let response = request
            .send()
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        let status_code = response.status();
        let status = status_code.as_u16();
        let status_text = safe_status_text(status_code);
        let redirected = response_was_redirected(&url, response.url());
        let safe_url = safe_response_url(&url);
        let mut headers = safe_response_headers(response.headers());
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() <= 160)
            .unwrap_or("application/octet-stream")
            .to_owned();
        headers
            .entry(reqwest::header::CONTENT_TYPE.as_str().to_owned())
            .or_insert_with(|| content_type.clone());
        let bytes = filter_excluded_account_provider(&url, bounded_response(response).await?)?;
        scope.ensure_current(state).await?;
        Ok(json!({
            "status": status,
            "status_text": status_text,
            "headers": headers,
            "content_type": content_type,
            "url": safe_url,
            "redirected": redirected,
            "body_base64": base64::engine::general_purpose::STANDARD.encode(bytes),
        }))
    }
    .await;
    if let Some(id) = operation_id {
        let _ =
            append_client_event(
                &scope.storage,
                &format!(
            "dashboard_plugin_request_finish operation_id={id} profile={} plugin={} outcome={}",
            scope.profile, plugin, if result.is_ok() { "completed" } else { "failed" }
        ),
            );
    }
    result
}

#[cfg(test)]
#[path = "tests/dashboard_plugins.rs"]
mod tests;
